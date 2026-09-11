-- Push outbox: a notification the owner should also receive on their
-- devices, queued in the same transaction that created it, delivered by
-- the minute cron. The queue is what makes "every notification is pushed"
-- true even when a push service is down or the request that created the
-- notification dies before it could send: nothing is sent from inside a
-- transaction, and nothing is lost if sending fails.
create table if not exists push_outbox (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  user_id       uuid not null references app_user(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 160),
  body          text not null check (char_length(body) between 1 and 500),
  url           text not null default '/app' check (url ~ '^/' and char_length(url) <= 300),
  tag           text check (char_length(tag) <= 200),
  attempts      integer not null default 0,
  deliver_after timestamptz not null default now(),
  delivered_at  timestamptz,
  last_error    text check (char_length(last_error) <= 300),
  created_at    timestamptz not null default now()
);

create index if not exists idx_push_outbox_due
  on push_outbox (deliver_after, id) where delivered_at is null;

alter table push_outbox enable row level security;
alter table push_outbox force row level security;
drop policy if exists push_outbox_tenant on push_outbox;
create policy push_outbox_tenant on push_outbox
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

-- The cron has no tenant. Like routine_due_targets (022), this returns ids
-- and nothing else; every read and write of the row happens in withTenant.
create or replace function public.push_outbox_due(
  p_now timestamptz,
  p_limit integer default 100
)
returns table (business_id uuid, outbox_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select o.business_id, o.id
    from public.push_outbox as o
   where o.delivered_at is null
     and o.deliver_after <= p_now
     and o.attempts < 8
   order by o.deliver_after, o.id
   limit greatest(1, least(p_limit, 500))
$$;

revoke all on function public.push_outbox_due(timestamptz, integer) from public;
grant execute on function public.push_outbox_due(timestamptz, integer) to aisar_app;
