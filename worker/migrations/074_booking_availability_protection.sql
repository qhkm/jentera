-- Booking availability protection. Public booking pages can read only cached
-- busy ranges; Google credentials remain in the main API Worker. Event titles
-- and other Calendar content are never stored here.

-- Lets the cache foreign keys prove the connection belongs to the same
-- business, rather than relying only on application code and RLS.
create unique index if not exists connection_business_id_id_key
  on connection (business_id, id);

create table if not exists booking_block (
  business_id uuid not null references business(id) on delete cascade,
  id          uuid not null default gen_random_uuid(),
  label       text not null check (char_length(label) between 1 and 80),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (business_id, id),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '31 days')
);
create index if not exists booking_block_window on booking_block (business_id, starts_at, ends_at);
alter table booking_block enable row level security;
alter table booking_block force row level security;
drop policy if exists booking_block_tenant on booking_block;
create policy booking_block_tenant on booking_block
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_block to aisar_app;

create table if not exists booking_calendar_availability (
  business_id    uuid primary key references business(id) on delete cascade,
  connection_id  uuid not null,
  synced_at      timestamptz,
  window_start   timestamptz,
  window_end     timestamptz,
  next_sync_at   timestamptz not null default now(),
  last_error     text check (last_error is null or char_length(last_error) <= 500),
  updated_at     timestamptz not null default now(),
  foreign key (business_id, connection_id) references connection(business_id, id) on delete cascade
);
create index if not exists booking_calendar_availability_due
  on booking_calendar_availability (next_sync_at, business_id);
alter table booking_calendar_availability enable row level security;
alter table booking_calendar_availability force row level security;
drop policy if exists booking_calendar_availability_tenant on booking_calendar_availability;
create policy booking_calendar_availability_tenant on booking_calendar_availability
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_calendar_availability to aisar_app;

create table if not exists booking_calendar_busy (
  business_id    uuid not null references business(id) on delete cascade,
  connection_id  uuid not null,
  event_key      text not null check (char_length(event_key) between 1 and 512),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  updated_at     timestamptz not null default now(),
  primary key (business_id, connection_id, event_key, starts_at),
  check (ends_at > starts_at),
  foreign key (business_id, connection_id) references connection(business_id, id) on delete cascade
);
create index if not exists booking_calendar_busy_window
  on booking_calendar_busy (business_id, starts_at, ends_at);
alter table booking_calendar_busy enable row level security;
alter table booking_calendar_busy force row level security;
drop policy if exists booking_calendar_busy_tenant on booking_calendar_busy;
create policy booking_calendar_busy_tenant on booking_calendar_busy
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_calendar_busy to aisar_app;

-- The cron has no tenant. Return business ids only; credentials and busy
-- ranges are read later inside withTenant.
create or replace function public.booking_calendar_availability_due(
  p_now timestamptz,
  p_limit integer default 10
)
returns table (business_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select i.business_id
    from public.app_installation i
   where i.app_key = 'bookings'
     and exists (
       select 1 from public.connection c
        where c.business_id = i.business_id and c.connector = 'google' and c.status = 'connected'
     )
     and (
       not exists (select 1 from public.booking_calendar_availability a where a.business_id = i.business_id)
       or exists (
         select 1 from public.booking_calendar_availability a
          where a.business_id = i.business_id and a.next_sync_at <= p_now
       )
       or exists (
         select 1 from public.connection c
          where c.business_id = i.business_id and c.connector = 'google' and c.status = 'connected'
            and not exists (
              select 1 from public.booking_calendar_availability a
               where a.business_id = i.business_id and a.connection_id = c.id
            )
       )
     )
   order by i.business_id
   limit greatest(1, least(coalesce(p_limit, 10), 20))
$$;
revoke all on function public.booking_calendar_availability_due(timestamptz, integer) from public;
grant execute on function public.booking_calendar_availability_due(timestamptz, integer) to aisar_app;
