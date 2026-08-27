/* Durable identity and bounded result for work executing inside a runtime. */

alter table runtime_task add column if not exists remote_run_id text;
alter table runtime_task add column if not exists remote_status text;
alter table runtime_task add column if not exists result jsonb;
alter table runtime_task add column if not exists started_at timestamptz;

create index if not exists idx_runtime_task_remote_run
  on runtime_task (business_id, remote_run_id)
  where remote_run_id is not null;
