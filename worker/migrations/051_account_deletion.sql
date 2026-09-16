-- Deleting an account is the one operation that must survive its own
-- cascade. Every tenant table references business(id) on delete cascade, so
-- deleting the business row erases the tenant data in one statement — and
-- with it the only record of what lives outside Postgres: artifact rows name
-- the R2 keys, runtime names the Fly sprite, connection names the provider
-- registrations to revoke. Cleanup that ran after the cascade would have
-- nothing to work from, which is how you get orphaned objects and a live
-- machine holding someone's memory with no row pointing at it.
--
-- So this table is NOT a tenant table, its business_id is set null rather
-- than cascading, and the identifiers are copied into it before anything is
-- deleted. It is what the retries work from.
alter table business add column if not exists deleted_at timestamptz;
alter table app_user add column if not exists deleted_at timestamptz;

create table if not exists account_deletion (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references business(id) on delete set null,
  user_id         uuid references app_user(id) on delete set null,
  email           text not null check (char_length(email) between 3 and 320),
  kind            text not null check (kind in ('owner', 'staff')),
  requested_at    timestamptz not null default now(),
  scheduled_for   timestamptz not null,
  stage           text not null default 'pending'
                  check (stage in ('pending', 'connectors', 'objects', 'sprite', 'tenant', 'identity', 'done', 'stalled')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text check (char_length(last_error) <= 300),
  artifact_keys   text[] not null default '{}',
  sprite_id       text check (char_length(sprite_id) <= 200),
  connector_ids   uuid[] not null default '{}',
  cancel_token_id text unique check (cancel_token_id ~ '^[0-9a-f]{64}$'),
  cancelled_at    timestamptz,
  completed_at    timestamptz
);

create index if not exists idx_account_deletion_due
  on account_deletion (next_attempt_at, id)
  where completed_at is null and cancelled_at is null;

-- No RLS: this table has no tenant once the cascade has run, and only the
-- cron and the account routes touch it. Reads are by id or by user.
grant select, insert, update, delete on account_deletion to aisar_app;

-- The cron has no tenant. Like push_outbox_due (031) and routine_due_targets
-- (022), this returns ids and nothing else.
create or replace function public.account_deletion_due(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (deletion_id uuid, business_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select d.id, d.business_id
    from public.account_deletion as d
   where d.completed_at is null
     and d.cancelled_at is null
     and d.stage <> 'stalled'
     and d.scheduled_for <= p_now
     and d.next_attempt_at <= p_now
     and d.attempts < 8
   order by d.next_attempt_at, d.id
   limit greatest(1, least(p_limit, 200))
$$;

revoke all on function public.account_deletion_due(timestamptz, integer) from public;
grant execute on function public.account_deletion_due(timestamptz, integer) to aisar_app;
