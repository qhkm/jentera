-- Honest booking reminders and customer-change policy. Jentera has no live
-- WhatsApp sender yet: these rows create owner push nudges whose booking card
-- contains a prefilled WhatsApp reminder. They never claim customer delivery.

alter table booking_settings add column if not exists change_cutoff_minutes integer not null default 360;
alter table booking_settings drop constraint if exists booking_settings_change_cutoff_check;
alter table booking_settings add constraint booking_settings_change_cutoff_check
  check (change_cutoff_minutes between 0 and 10080);

create table if not exists booking_reminder (
  business_id   uuid not null,
  booking_id    uuid not null,
  offset_minutes integer not null check (offset_minutes in (120, 1440)),
  due_at        timestamptz not null,
  status        text not null default 'pending' check (status in ('pending', 'notified', 'cancelled')),
  notified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (business_id, booking_id, offset_minutes),
  foreign key (business_id, booking_id) references booking (business_id, id) on delete cascade
);
create index if not exists booking_reminder_due on booking_reminder (due_at, booking_id)
  where status = 'pending';
alter table booking_reminder enable row level security;
alter table booking_reminder force row level security;
drop policy if exists booking_reminder_tenant on booking_reminder;
create policy booking_reminder_tenant on booking_reminder
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on booking_reminder to aisar_app;
revoke delete, truncate, references, trigger on booking_reminder from aisar_app;

-- Existing future confirmations should receive only reminders that have not
-- already passed when this migration is applied.
insert into booking_reminder (business_id, booking_id, offset_minutes, due_at)
select b.business_id, b.id, offsets.minutes,
       b.starts_at - make_interval(mins => offsets.minutes)
  from booking b cross join (values (1440), (120)) as offsets(minutes)
 where b.status = 'confirmed' and b.starts_at > now()
   and b.starts_at - make_interval(mins => offsets.minutes) > now()
on conflict (business_id, booking_id, offset_minutes) do nothing;

create or replace function public.booking_reminders_due(p_now timestamptz, p_limit integer default 100)
returns table (business_id uuid, booking_id uuid, offset_minutes integer)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.business_id, r.booking_id, r.offset_minutes
    from public.booking_reminder r
    join public.booking b on b.business_id = r.business_id and b.id = r.booking_id
   where r.status = 'pending' and r.due_at <= p_now
     and b.status = 'confirmed' and b.starts_at > p_now
   order by r.due_at, r.booking_id, r.offset_minutes desc
   limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.booking_reminders_due(timestamptz, integer) from public;
grant execute on function public.booking_reminders_due(timestamptz, integer) to aisar_app;
