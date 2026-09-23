-- Apps (migration 068). The first app is Bookings: a public page where a
-- business's customers request a time, and the owner's list behind it.
-- Every table is tenant-scoped under forced RLS. The public page finds a
-- business only through bookings_by_slug, a security definer that returns the
-- business id and its current (public) link name and nothing else; everything
-- after that runs inside withTenant.
-- Spec: docs/plans/2026-09-23-apps-shell-and-bookings-v1.md

create table if not exists app_installation (
  business_id    uuid not null references business(id) on delete cascade,
  app_key        text not null check (app_key in ('bookings')),
  state          text not null default 'active' check (state in ('active', 'paused')),
  public_slug    text not null check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  -- An integer, not updated_at: a JS Date drops Postgres microseconds, so a
  -- timestamp version would report false conflicts.
  config_version integer not null default 1 check (config_version >= 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (business_id, app_key)
);
create unique index if not exists app_installation_slug on app_installation (public_slug);
alter table app_installation enable row level security;
alter table app_installation force row level security;
drop policy if exists app_installation_tenant on app_installation;
create policy app_installation_tenant on app_installation
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on app_installation to aisar_app;
revoke delete, truncate, references, trigger on app_installation from aisar_app;

-- Every link name a business has published. A name stays with the business
-- that first used it, so a link shared before a rename can only ever reach
-- the same business (the public page redirects it to the current name) and
-- never another one. Rows are never updated or deleted.
create table if not exists app_slug (
  public_slug text primary key check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  business_id uuid not null references business(id) on delete cascade,
  app_key     text not null check (app_key in ('bookings')),
  created_at  timestamptz not null default now()
);
create index if not exists app_slug_business on app_slug (business_id);
alter table app_slug enable row level security;
alter table app_slug force row level security;
drop policy if exists app_slug_tenant on app_slug;
create policy app_slug_tenant on app_slug
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert on app_slug to aisar_app;
revoke update, delete, truncate, references, trigger on app_slug from aisar_app;

create table if not exists booking_settings (
  business_id                  uuid primary key references business(id) on delete cascade,
  accepting                    boolean not null default true,
  availability_acknowledged_at timestamptz not null,
  min_notice_minutes           integer not null default 120 check (min_notice_minutes between 0 and 10080),
  horizon_days                 integer not null default 30 check (horizon_days between 1 and 90),
  updated_at                   timestamptz not null default now()
);
alter table booking_settings enable row level security;
alter table booking_settings force row level security;
drop policy if exists booking_settings_tenant on booking_settings;
create policy booking_settings_tenant on booking_settings
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on booking_settings to aisar_app;
revoke delete, truncate, references, trigger on booking_settings from aisar_app;

create table if not exists booking_service (
  business_id      uuid not null references business(id) on delete cascade,
  id               uuid not null default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 80),
  duration_minutes integer not null check (duration_minutes between 15 and 480 and duration_minutes % 15 = 0),
  capacity         integer not null default 1 check (capacity between 1 and 50),
  price_label      text check (char_length(price_label) <= 40),
  active           boolean not null default true,
  sort             integer not null default 0,
  primary key (business_id, id)
);
alter table booking_service enable row level security;
alter table booking_service force row level security;
drop policy if exists booking_service_tenant on booking_service;
create policy booking_service_tenant on booking_service
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_service to aisar_app;
revoke truncate, references, trigger on booking_service from aisar_app;

create table if not exists booking_hours (
  business_id uuid not null,
  service_id  uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  opens       time not null,
  closes      time not null,
  check (closes > opens),
  primary key (business_id, service_id, weekday, opens),
  foreign key (business_id, service_id) references booking_service (business_id, id) on delete cascade
);
alter table booking_hours enable row level security;
alter table booking_hours force row level security;
drop policy if exists booking_hours_tenant on booking_hours;
create policy booking_hours_tenant on booking_hours
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on booking_hours to aisar_app;
revoke truncate, references, trigger on booking_hours from aisar_app;

create table if not exists booking (
  business_id            uuid not null,
  id                     uuid not null default gen_random_uuid(),
  reference              text not null check (reference ~ '^[A-HJ-NP-Z2-9]{6}$'),
  submission_key         uuid not null,
  submission_hash        text not null check (char_length(submission_hash) between 1 and 128),
  service_id             uuid not null,
  service_name           text not null check (char_length(service_name) between 1 and 80),
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  party_size             integer not null check (party_size between 1 and 50),
  customer_name          text not null check (char_length(customer_name) between 1 and 80),
  customer_phone         text not null check (customer_phone ~ '^60[0-9]{8,11}$'),
  note                   text check (char_length(note) <= 500),
  status                 text not null default 'pending'
                         check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  decided_at             timestamptz,
  decided_by             uuid references app_user(id) on delete set null,
  cancelled_at           timestamptz,
  cancelled_by           uuid references app_user(id) on delete set null,
  calendar_status        text not null default 'none'
                         check (calendar_status in ('none', 'pending', 'created', 'failed', 'not_connected', 'removed')),
  -- connection.id is a single-column key; a composite tenant key is not
  -- available. The value is only ever set from findConnection under RLS.
  calendar_connection_id uuid references connection(id) on delete set null,
  calendar_event_id      text check (char_length(calendar_event_id) <= 1024),
  calendar_error         text check (char_length(calendar_error) <= 300),
  created_at             timestamptz not null default now(),
  check (ends_at > starts_at),
  primary key (business_id, id),
  unique (business_id, reference),
  unique (business_id, submission_key),
  foreign key (business_id, service_id) references booking_service (business_id, id)
);
create index if not exists booking_slot on booking (business_id, service_id, starts_at)
  where status in ('pending', 'confirmed');
create index if not exists booking_window on booking (business_id, starts_at);
create index if not exists booking_created on booking (business_id, created_at);
alter table booking enable row level security;
alter table booking force row level security;
drop policy if exists booking_tenant on booking;
create policy booking_tenant on booking
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on booking to aisar_app;
revoke delete, truncate, references, trigger on booking from aisar_app;

-- One row per booking: the Calendar state the booking wants. The executor
-- (plan 3) claims a row with a lease, acts outside the transaction, and
-- completes only when its lease and revision still match.
create table if not exists booking_calendar_job (
  business_id        uuid not null,
  booking_id         uuid not null,
  desired            text not null check (desired in ('present', 'absent')),
  revision           integer not null default 1 check (revision >= 1),
  completed_revision integer,
  attempts           integer not null default 0 check (attempts >= 0),
  next_attempt_at    timestamptz not null default now(),
  lease_token        uuid,
  lease_expires_at   timestamptz,
  last_error         text check (char_length(last_error) <= 300),
  updated_at         timestamptz not null default now(),
  primary key (business_id, booking_id),
  foreign key (business_id, booking_id) references booking (business_id, id) on delete cascade
);
create index if not exists booking_calendar_job_due on booking_calendar_job (next_attempt_at, booking_id)
  where completed_revision is distinct from revision;
alter table booking_calendar_job enable row level security;
alter table booking_calendar_job force row level security;
drop policy if exists booking_calendar_job_tenant on booking_calendar_job;
create policy booking_calendar_job_tenant on booking_calendar_job
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on booking_calendar_job to aisar_app;
revoke delete, truncate, references, trigger on booking_calendar_job from aisar_app;

-- The public page has no tenant. Like invitation_by_token (035) this returns
-- an id — plus the business's current link name, which is public anyway, so
-- a held name can redirect. Paused installations resolve so the page can say
-- "not taking bookings". The pilot flag is checked in the Worker.
drop function if exists public.bookings_by_slug(text);
create function public.bookings_by_slug(p_slug text)
returns table (business_id uuid, current_slug text)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select a.business_id, a.public_slug from public.app_installation a
   where a.public_slug = p_slug and a.app_key = 'bookings'
  union all
  select a.business_id, a.public_slug from public.app_slug s
    join public.app_installation a on a.business_id = s.business_id and a.app_key = s.app_key
   where s.public_slug = p_slug and s.app_key = 'bookings'
  limit 1
$$;
revoke all on function public.bookings_by_slug(text) from public;
grant execute on function public.bookings_by_slug(text) to aisar_app;

-- The cron has no tenant either. Ids only, like push_outbox_due (031).
create or replace function public.booking_calendar_due(p_now timestamptz, p_limit integer default 50)
returns table (business_id uuid, booking_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select j.business_id, j.booking_id from public.booking_calendar_job j
   where j.completed_revision is distinct from j.revision
     and j.next_attempt_at <= p_now
     and j.attempts < 8
     and (j.lease_expires_at is null or j.lease_expires_at <= p_now)
   order by j.next_attempt_at, j.booking_id
   limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.booking_calendar_due(timestamptz, integer) from public;
grant execute on function public.booking_calendar_due(timestamptz, integer) to aisar_app;

-- Where a notification leads, stored so the in-app inbox and the push open
-- the same place. Generic, so later apps do not each add a foreign key here.
-- Internal workspace paths only.
alter table notification add column if not exists url text;
alter table notification drop constraint if exists notification_url_check;
alter table notification add constraint notification_url_check check (
  url is null or (char_length(url) <= 300 and url ~ '^/app([/?#]|$)'));

alter table notification drop constraint if exists notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'reminder_due', 'booking_requested'
));
