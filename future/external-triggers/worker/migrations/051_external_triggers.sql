-- Narrow, owner-authorised external report pilot. Never stores event instructions.
create table if not exists external_trigger (
  id uuid primary key,
  business_id uuid not null references business(id) on delete cascade,
  authorised_by uuid not null references app_user(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  task text not null check (task in ('business_summary', 'weekly_summary', 'approval_reminder')),
  time_zone text not null check (time_zone = 'Asia/Kuala_Lumpur'),
  ciphertext bytea,
  key_version integer not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  check (revoked_at is not null or ciphertext is not null),
  unique (business_id, id)
);
create index if not exists external_trigger_business on external_trigger(business_id);
alter table external_trigger enable row level security;
alter table external_trigger force row level security;
drop policy if exists external_trigger_tenant on external_trigger;
create policy external_trigger_tenant on external_trigger
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
-- Override 000_role's broad default privileges for these security-critical rows.
revoke all on external_trigger from public, aisar_app;
grant select, insert on external_trigger to aisar_app;
grant update (revoked_at, revoked_by, ciphertext) on external_trigger to aisar_app;

create unique index if not exists idx_run_external_tenant_ref on run(business_id, id);
create table if not exists external_trigger_event (
  business_id uuid not null references business(id) on delete cascade,
  trigger_id uuid not null,
  event_id uuid not null,
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  -- Report retention must not erase dedupe evidence while its grant is active.
  run_id uuid,
  created_at timestamptz not null default now(),
  primary key (trigger_id, event_id),
  foreign key (business_id, trigger_id) references external_trigger(business_id, id) on delete cascade,
  foreign key (business_id, run_id) references run(business_id, id) on delete set null (run_id)
);
create index if not exists external_trigger_event_quota on external_trigger_event(business_id, created_at);
alter table external_trigger_event enable row level security;
alter table external_trigger_event force row level security;
drop policy if exists external_trigger_event_tenant on external_trigger_event;
create policy external_trigger_event_tenant on external_trigger_event
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
revoke all on external_trigger_event from public, aisar_app;
grant select, insert on external_trigger_event to aisar_app;

-- Private routing metadata only: no credentials, names, reports or authorisers.
-- A separate lookup avoids relying on a definer bypassing FORCE RLS, which is
-- not portable across managed Postgres roles. The API role cannot read/list it.
create table if not exists external_trigger_route (
  id uuid primary key references external_trigger(id) on delete cascade,
  business_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
revoke all on external_trigger_route from public, aisar_app;
create or replace function public.external_trigger_sync_route()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.external_trigger_route(id, business_id, expires_at, revoked_at)
    values (new.id, new.business_id, new.expires_at, new.revoked_at)
    on conflict (id) do update set business_id = excluded.business_id,
      expires_at = excluded.expires_at, revoked_at = excluded.revoked_at;
  return new;
end;
$$;
revoke all on function public.external_trigger_sync_route() from public, aisar_app;
drop trigger if exists external_trigger_sync_route on external_trigger;
create trigger external_trigger_sync_route after insert or update on external_trigger
  for each row execute function public.external_trigger_sync_route();

-- Exact opaque ID to tenant, no secret/business content. Called only after
-- cheap signature-shape, freshness, body, method and burst checks.
create or replace function public.external_trigger_target(p_id uuid)
returns table (business_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select t.business_id from public.external_trigger_route t
  where t.id = p_id and t.revoked_at is null and t.expires_at > now()
$$;
revoke all on function public.external_trigger_target(uuid) from public;
grant execute on function public.external_trigger_target(uuid) to aisar_app;

alter table notification drop constraint if exists notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'reminder_due', 'external_report'
));
