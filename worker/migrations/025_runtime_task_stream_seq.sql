-- The runner replays a task's whole event history to every subscriber, so a
-- second observation slice, an approval resume, or a retry after a lost
-- lease relayed the same answer text to the web chat again. The last runner
-- event seq a slice relayed is kept with the task; the next slice asks the
-- runner client to skip everything at or before it.
alter table runtime_task
  add column if not exists stream_seq integer not null default 0;
