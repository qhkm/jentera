/* ============================================================
   Durable runtime wakeups, lease-owner recovery, dispatch phases, and
   cancellation/usage finalization state.

   Queue messages are only wake signals. runtime_task and its outbox remain
   authoritative across Worker death, Queue publication failure, and bounded
   observation slices.
   ============================================================ */

alter table public.runtime_task
  add column if not exists dispatch_phase text not null default 'not_dispatched',
  add column if not exists lease_heartbeat_at timestamptz,
  add column if not exists cancel_state text not null default 'none';

alter table public.runtime_task drop constraint if exists runtime_task_status_check;
alter table public.runtime_task add constraint runtime_task_status_check
  check (status in (
    'queued','leased','completed','failed','cancel_requested','cancelled','exhausted'
  ));

update public.runtime_task
   set lease_heartbeat_at = coalesce(updated_at, now())
 where status = 'leased' and lease_heartbeat_at is null;

update public.runtime_task
   set dispatch_phase = 'remotely_running'
 where remote_run_id is not null and dispatch_phase = 'not_dispatched';

update public.runtime_task
   set cancel_state = 'confirmed'
 where status = 'cancelled' and cancel_state = 'none';

alter table public.runtime_task drop constraint if exists runtime_task_dispatch_phase_check;
alter table public.runtime_task add constraint runtime_task_dispatch_phase_check
  check (dispatch_phase in ('not_dispatched', 'ambiguously_dispatched', 'remotely_running'));

alter table public.runtime_task drop constraint if exists runtime_task_cancel_state_check;
alter table public.runtime_task add constraint runtime_task_cancel_state_check
  check (cancel_state in ('none', 'requested', 'confirmed', 'failed'));

alter table public.runtime_task drop constraint if exists runtime_task_lease_heartbeat_check;
alter table public.runtime_task add constraint runtime_task_lease_heartbeat_check check (
  (status = 'leased' and lease_heartbeat_at is not null) or
  (status <> 'leased' and lease_heartbeat_at is null)
);

create index if not exists idx_runtime_task_dead_owner
  on public.runtime_task (lease_heartbeat_at, business_id, id)
  where status = 'leased';

create table if not exists public.runtime_task_outbox (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business(id) on delete cascade,
  task_id     uuid not null references public.runtime_task(id) on delete cascade,
  not_before  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0 check (attempts >= 0),
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists idx_runtime_task_outbox_one_pending
  on public.runtime_task_outbox (task_id)
  where sent_at is null;

create index if not exists idx_runtime_task_outbox_pending
  on public.runtime_task_outbox (not_before, created_at)
  where sent_at is null;

alter table public.runtime_task_outbox enable row level security;
alter table public.runtime_task_outbox force row level security;
drop policy if exists runtime_task_outbox_tenant on public.runtime_task_outbox;
create policy runtime_task_outbox_tenant on public.runtime_task_outbox
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid)
  with check (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

create or replace function public.queue_runtime_task_wake()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status in ('queued', 'failed') and (
    tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.available_at is distinct from new.available_at
  ) then
    insert into public.runtime_task_outbox (business_id, task_id, not_before)
    values (new.business_id, new.id, new.available_at)
    on conflict (task_id) where sent_at is null do update
      set not_before = excluded.not_before,
          last_error = null,
          updated_at = pg_catalog.now();
  end if;
  return new;
end
$$;

drop trigger if exists runtime_task_queue_wake on public.runtime_task;
create trigger runtime_task_queue_wake
after insert or update of status, available_at on public.runtime_task
for each row execute function public.queue_runtime_task_wake();

insert into public.runtime_task_outbox (business_id, task_id, not_before)
select t.business_id, t.id, t.available_at
  from public.runtime_task as t
 where t.status in ('queued', 'failed')
on conflict (task_id) where sent_at is null do nothing;

create or replace function public.runtime_outbox_batch(
  p_limit integer default 100,
  p_task_id uuid default null
)
returns table (
  outbox_id uuid,
  business_id uuid,
  task_id uuid,
  not_before timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select o.id, o.business_id, o.task_id, o.not_before
    from public.runtime_task_outbox as o
   where o.sent_at is null
     and (p_task_id is null or o.task_id = p_task_id)
   order by o.not_before, o.created_at, o.id
   limit greatest(1, least(p_limit, 100))
$$;

revoke all on function public.runtime_outbox_batch(integer, uuid) from public;
grant execute on function public.runtime_outbox_batch(integer, uuid) to aisar_app;

create or replace function public.runtime_recovery_targets(
  p_after_business_id uuid default null,
  p_after_task_id uuid default null,
  p_limit integer default 25,
  p_dead_after interval default interval '90 seconds'
)
returns table (
  business_id uuid,
  task_id uuid,
  dispatch_phase text,
  lease_heartbeat_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select t.business_id, t.id, t.dispatch_phase, t.lease_heartbeat_at
    from public.runtime_task as t
   where t.status = 'leased'
     and t.lease_heartbeat_at <= pg_catalog.now() - p_dead_after
     and (
       p_after_business_id is null
       or (t.business_id, t.id) > (p_after_business_id, p_after_task_id)
     )
   order by t.business_id, t.id
   limit greatest(1, least(p_limit, 100))
$$;

revoke all on function public.runtime_recovery_targets(uuid, uuid, integer, interval) from public;
grant execute on function public.runtime_recovery_targets(uuid, uuid, integer, interval) to aisar_app;

alter table public.runtime_usage
  add column if not exists finalization_state text not null default 'reserved',
  add column if not exists finalization_method text;

update public.runtime_usage
   set finalization_state = case when status = 'reserved' then 'reserved' else 'finalized' end,
       finalization_method = case when status = 'reserved' then null else 'estimated' end
 where finalization_method is null;

alter table public.runtime_usage drop constraint if exists runtime_usage_finalization_state_check;
alter table public.runtime_usage add constraint runtime_usage_finalization_state_check
  check (finalization_state in ('reserved', 'finalizing', 'finalized'));

alter table public.runtime_usage drop constraint if exists runtime_usage_finalization_method_check;
alter table public.runtime_usage add constraint runtime_usage_finalization_method_check
  check (finalization_method is null or finalization_method in ('measured', 'estimated'));

/* Re-apply the hardened drift function for databases where migration 018 was
   already deployed with its old no-argument, SETOF agent_runtime signature. */
drop function if exists public.runtime_drift_targets();

create or replace function public.runtime_drift_targets(
  p_current_release text,
  p_after_business_id uuid default null,
  p_limit integer default 25,
  p_stuck_after interval default interval '15 minutes'
)
returns table (runtime_id uuid, business_id uuid, repair_episode text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select ar.id,
         ar.business_id,
         md5(ar.id::text || ':' || extract(epoch from ar.updated_at)::text || ':' ||
             coalesce(ar.status, '') || ':' || p_current_release) as repair_episode
    from public.agent_runtime as ar
   where ar.deleted_at is null
     and (p_after_business_id is null or ar.business_id > p_after_business_id)
     and (
       (ar.status in ('ready', 'cold', 'idle', 'busy', 'error') and (
         ar.desired_release is distinct from p_current_release
         or ar.observed_release is distinct from p_current_release
         or ar.status = 'error'
       ))
       or (ar.status in ('provisioning', 'upgrading')
           and ar.updated_at <= pg_catalog.now() - p_stuck_after)
     )
   order by ar.business_id
   limit greatest(1, least(p_limit, 100))
$$;

revoke all on function public.runtime_drift_targets(text, uuid, integer, interval) from public;
grant execute on function public.runtime_drift_targets(text, uuid, integer, interval) to aisar_app;
