-- One notification kind for the person who asked in the app.
--
--   work_finished   a work task asked for in the app finished or failed,
--                   two minutes or more after it was asked; only the person
--                   who asked is told (notifications/work.ts)
--
-- The list is every kind from 040_reminders.sql plus booking_requested
-- (068_apps_bookings.sql, on the bookings-v1 branch) plus work_finished. A
-- check constraint is replaced whole, so whichever migration is applied last
-- decides the list; naming both new kinds in both migrations makes the order
-- they are applied in not matter. booking_requested is inert until Bookings
-- ships.
alter table notification drop constraint if exists notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'reminder_due', 'booking_requested',
  'work_finished'
));
