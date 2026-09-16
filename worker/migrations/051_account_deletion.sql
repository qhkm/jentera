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

-- An invitation names an address, and the address is the personal data. The
-- spec says any open invitation for it goes, not only the ones in the
-- business the person belonged to: a business that invited them and was never
-- answered keeps their address forever otherwise.
--
-- `invitation` is a tenant table under forced RLS, so aisar_app cannot even
-- see rows in another business — which is the point. This reads ids and
-- nothing else, like account_deletion_due above and invitation_by_token
-- (035); the DELETE is then done by the app role inside withTenant for each
-- business it names, where the table's own policy is what bounds it. A
-- definer that deleted would be a cross-tenant DELETE primitive granted to
-- the app role, correct only as long as every caller passed the right
-- address — exactly what 052's header refuses to build.
--
-- Bounded to an address with a deletion in flight, so it answers nothing
-- about anyone else: no in-flight deletion, no rows, whoever asks.
create or replace function public.invitations_for_email(p_email text)
returns table (invitation_id uuid, business_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select i.id, i.business_id
    from public.invitation as i
   where i.email = lower(p_email)
     and exists (
       select 1
         from public.account_deletion as d
        where d.email = lower(p_email)
          and d.cancelled_at is null
          and d.completed_at is null)
$$;

revoke all on function public.invitations_for_email(text) from public;
grant execute on function public.invitations_for_email(text) to aisar_app;
