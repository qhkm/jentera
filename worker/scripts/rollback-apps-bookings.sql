-- Undo 068_apps_bookings.sql.
--
-- Drops the seven Bookings tables, the two functions, and notification.url
-- with its check. It refuses while any business has installed Bookings or any
-- booking exists: past that point a rollback deletes customers' bookings, and
-- that is a decision, not a script. notification_kind_check is left alone:
-- 069_work_finished_notification.sql allows the same kinds.
--
--   psql "$AISAR_NEON_OWNER_URL" -v ON_ERROR_STOP=1 -f worker/scripts/rollback-apps-bookings.sql

begin;

-- Nested, not `and`: PL/pgSQL plans the whole condition, so a query on a
-- table that is already gone would fail even behind a false test.
do $$
begin
  if to_regclass('public.app_installation') is not null then
    if exists (select 1 from app_installation) then
      raise exception 'Bookings is installed for a business; refusing to drop its data';
    end if;
  end if;
  if to_regclass('public.booking') is not null then
    if exists (select 1 from booking) then
      raise exception 'bookings exist; refusing to drop them';
    end if;
  end if;
end $$;

drop function if exists public.booking_calendar_due(timestamptz, integer);
drop function if exists public.bookings_by_slug(text);

drop table if exists booking_calendar_job;
drop table if exists booking;
drop table if exists booking_hours;
drop table if exists booking_service;
drop table if exists booking_settings;
drop table if exists app_slug;
drop table if exists app_installation;

alter table notification drop constraint if exists notification_url_check;
alter table notification drop column if exists url;

commit;
