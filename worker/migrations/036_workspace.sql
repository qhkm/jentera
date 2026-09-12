-- Workspaces: a named space inside a business with its own members, whose
-- chats every member may read and continue. A chat is personal unless it
-- was opened inside a workspace, and it does not move afterwards.
--
-- Keys follow chat_session: (business_id, id), so a workspace can only be
-- referenced from its own business, and membership is one row per person
-- per workspace. The owner manages workspaces; being able to read one is
-- explicit membership for everyone, the owner included.
create table if not exists workspace (
  id           uuid not null default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  created_by   uuid not null references app_user(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (business_id, id)
);

create table if not exists workspace_member (
  business_id  uuid not null,
  workspace_id uuid not null,
  user_id      uuid not null references app_user(id) on delete cascade,
  added_by     uuid references app_user(id) on delete set null,
  added_at     timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (business_id, workspace_id) references workspace (business_id, id) on delete cascade
);

create index if not exists idx_workspace_member_user
  on workspace_member (business_id, user_id);

alter table workspace enable row level security;
alter table workspace force row level security;
drop policy if exists workspace_tenant on workspace;
create policy workspace_tenant on workspace
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

alter table workspace_member enable row level security;
alter table workspace_member force row level security;
drop policy if exists workspace_member_tenant on workspace_member;
create policy workspace_member_tenant on workspace_member
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

-- A chat opened inside a workspace points at it for life.
alter table chat_session add column if not exists workspace_id uuid;
alter table chat_session drop constraint if exists chat_session_workspace_fk;
alter table chat_session add constraint chat_session_workspace_fk
  foreign key (business_id, workspace_id) references workspace (business_id, id);
create index if not exists idx_chat_session_workspace
  on chat_session (business_id, workspace_id, last_at desc) where workspace_id is not null;
