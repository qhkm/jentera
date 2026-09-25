-- One notification kind for the month's AI credits.
--
--   credit_warning   a business has used 80% of this month's AI credits
--                    (cost or computer time, whichever is nearer its cap);
--                    every owner is told once a month
--                    (runtime/credit-warning.ts)
--
-- The check is replaced whole, so the list names every kind in use:
-- 040_reminders.sql's, booking_requested (068), work_finished (069), and
-- credit_warning.
alter table notification drop constraint if exists notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'reminder_due', 'booking_requested',
  'work_finished', 'credit_warning'
));
