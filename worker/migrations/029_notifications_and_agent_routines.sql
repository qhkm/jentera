-- Durable owner notifications and Sprite-backed scheduled agent work.

alter table routine add column if not exists task_prompt text;
alter table routine drop constraint if exists routine_task_kind_check;
alter table routine add constraint routine_task_kind_check
  check (task_kind in ('business_summary','weekly_summary','approval_reminder','agent_task'));
alter table routine drop constraint if exists routine_task_prompt_check;
alter table routine add constraint routine_task_prompt_check check (
  (task_kind = 'agent_task' and task_prompt is not null
    and char_length(task_prompt) between 1 and 2000)
  or (task_kind <> 'agent_task' and task_prompt is null)
);

create unique index if not exists idx_routine_occurrence_business_id_id
  on routine_occurrence (business_id, id);

create table if not exists notification (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references business(id) on delete cascade,
  recipient_user_id uuid not null references app_user(id) on delete cascade,
  kind              text not null check (kind in (
                      'routine_completed','routine_failed','routine_skipped','routine_needs_approval'
                    )),
  title             text not null check (char_length(title) between 1 and 160),
  body              text not null check (char_length(body) between 1 and 500),
  run_id            uuid references run(id) on delete set null,
  routine_id        uuid,
  occurrence_id     uuid,
  source_key        text not null check (char_length(source_key) between 1 and 200),
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (business_id, routine_id) references routine(business_id, id) on delete cascade,
  foreign key (business_id, occurrence_id) references routine_occurrence(business_id, id) on delete cascade,
  unique (business_id, recipient_user_id, source_key)
);

create index if not exists idx_notification_recipient
  on notification (business_id, recipient_user_id, created_at desc, id desc);
create index if not exists idx_notification_unread
  on notification (business_id, recipient_user_id, created_at desc)
  where read_at is null;

alter table notification enable row level security;
alter table notification force row level security;
drop policy if exists notification_tenant on notification;
create policy notification_tenant on notification
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

grant select, insert, update on notification to aisar_app;
revoke delete, truncate, references, trigger on notification from aisar_app;
