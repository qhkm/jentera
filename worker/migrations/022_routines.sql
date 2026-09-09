-- Routines v1: owner-scheduled deterministic jobs (docs/plans/2026-09-09-routines-api-v1.md).
--
-- Postgres is the only scheduler. A routine holds the owner's configuration
-- and the next intended trigger; an occurrence is one intended invocation,
-- including a skipped one; a change row is the idempotency and audit record
-- for every owner mutation. Tenant ownership travels with every foreign key:
-- an occurrence references its routine by (business_id, id), so a matching
-- uuid from another tenant cannot satisfy it.

create table if not exists routine (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references business(id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  task_kind          text not null
                     check (task_kind in ('business_summary','weekly_summary','approval_reminder')),
  frequency          text not null check (frequency in ('daily','weekdays','weekly')),
  weekday            smallint check (weekday between 1 and 7),
  time_of_day        text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone          text not null,
  delivery           text not null default 'workspace' check (delivery = 'workspace'),
  status             text not null check (status in ('active','paused')),
  revision           integer not null default 1 check (revision >= 1),
  -- The next intended trigger. Null while paused. Advanced by the dispatcher
  -- inside the same transaction that admits the occurrence for it.
  next_run_at        timestamptz,
  created_by         uuid not null references app_user(id),
  -- The owner whose authority the schedule runs under: the creator, or the
  -- owner who last resumed it. Losing owner membership pauses the routine.
  authorised_by      uuid not null references app_user(id),
  create_request_id  uuid not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((frequency = 'weekly') = (weekday is not null)),
  unique (business_id, id),
  unique (business_id, create_request_id)
);

create index if not exists idx_routine_due on routine (next_run_at)
  where status = 'active' and next_run_at is not null;
create index if not exists idx_routine_business on routine (business_id, created_at);

create table if not exists routine_occurrence (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references business(id) on delete cascade,
  routine_id         uuid not null,
  routine_revision   integer not null,
  trigger            text not null check (trigger in ('scheduled','manual')),
  scheduled_for      timestamptz not null,
  started_at         timestamptz,
  finished_at        timestamptz,
  status             text not null
                     check (status in ('queued','working','needs_approval','completed','failed','cancelled','skipped')),
  run_id             uuid references run(id),
  summary            text check (summary is null or char_length(summary) <= 500),
  reason             text check (reason is null or reason in (
                       'nothing_pending','missed_window','previous_run_active',
                       'budget_exceeded','runtime_unavailable','permission_revoked')),
  -- Idempotency key of a manual run; null for scheduled occurrences.
  request_id         uuid,
  -- The task and schedule as confirmed when this occurrence was admitted.
  snapshot           jsonb not null,
  created_at         timestamptz not null default now(),
  foreign key (business_id, routine_id) references routine (business_id, id) on delete cascade,
  check ((status = 'skipped') = (run_id is null and reason is not null) or status <> 'skipped'),
  check (status <> 'skipped' or run_id is null)
);

-- One intended invocation per slot: queue redelivery, dispatcher overlap and
-- restarts land on this row instead of creating a second execution.
create unique index if not exists idx_routine_occurrence_slot
  on routine_occurrence (business_id, routine_id, scheduled_for)
  where trigger = 'scheduled';
create unique index if not exists idx_routine_occurrence_request
  on routine_occurrence (business_id, request_id)
  where request_id is not null;
create index if not exists idx_routine_occurrence_list
  on routine_occurrence (business_id, routine_id, scheduled_for desc, id desc);
create index if not exists idx_routine_occurrence_active
  on routine_occurrence (business_id, routine_id)
  where status in ('queued','working','needs_approval');

create table if not exists routine_change (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references business(id) on delete cascade,
  routine_id       uuid not null,
  request_id       uuid not null,
  operation        text not null check (operation in ('create','update','state','run')),
  -- sha-256 of the canonical request; a replay with a different body conflicts.
  request_hash     text not null,
  revision_before  integer,
  revision_after   integer not null,
  actor            uuid not null references app_user(id),
  created_at       timestamptz not null default now(),
  foreign key (business_id, routine_id) references routine (business_id, id) on delete cascade,
  unique (business_id, request_id)
);

alter table routine enable row level security;
alter table routine force row level security;
drop policy if exists routine_tenant on routine;
create policy routine_tenant on routine
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

alter table routine_occurrence enable row level security;
alter table routine_occurrence force row level security;
drop policy if exists routine_occurrence_tenant on routine_occurrence;
create policy routine_occurrence_tenant on routine_occurrence
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

alter table routine_change enable row level security;
alter table routine_change force row level security;
drop policy if exists routine_change_tenant on routine_change;
create policy routine_change_tenant on routine_change
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

-- v1 never deletes: pause is the recoverable stop. 000_role.sql's default
-- privileges hand every new table select/insert/update/delete, so the
-- grants below are stated in full and the rest revoked explicitly. The
-- audit table is append-only for the app role.
grant select, insert, update on routine to aisar_app;
revoke delete, truncate, references, trigger on routine from aisar_app;
grant select, insert, update on routine_occurrence to aisar_app;
revoke delete, truncate, references, trigger on routine_occurrence from aisar_app;
grant select, insert on routine_change to aisar_app;
revoke update, delete, truncate, references, trigger on routine_change from aisar_app;

-- The dispatcher runs without a tenant, where a plain select is RLS-filtered
-- to nothing. This function returns only what the claim needs and nothing a
-- route could turn into a cross-tenant read; the claim itself happens inside
-- withTenant for each business. Precedent: runtime_drift_targets (018/019).
create or replace function public.routine_due_targets(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (business_id uuid, routine_id uuid, next_run_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.business_id, r.id, r.next_run_at
    from public.routine as r
   where r.status = 'active'
     and r.next_run_at is not null
     and r.next_run_at <= p_now
   order by r.next_run_at, r.id
   limit greatest(1, least(p_limit, 200))
$$;

revoke all on function public.routine_due_targets(timestamptz, integer) from public;
grant execute on function public.routine_due_targets(timestamptz, integer) to aisar_app;
