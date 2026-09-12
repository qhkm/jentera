-- Two notification kinds for a business with more than one person in it.
--
--   work_needs_you       a colleague's task ended waiting on the owner —
--                        needs review, needs input, or blocked — and the
--                        owner was not the one who asked
--   approval_requested   an action awaits an owner's decision, and the
--                        owner was not the one who asked
--
-- Both are addressed to owners other than the requester, so a business of
-- one person, where the owner asks everything, receives none of them.
-- routine_id and occurrence_id stay null for these; run_id carries the task.
alter table notification drop constraint if exists notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested'
));
