-- Chat sessions: one row per chat the app opens, owned by whoever opened
-- it. Until now a chat existed only in the owner's browser and the run
-- carried its id inside trigger_ref; with more than one person in a
-- business, who may read a run depends on whose chat it belongs to, so
-- the chat becomes a row and the run points at it.
--
-- The id is the one the app generates for the chat, so the primary key is
-- (business_id, id): the same uuid sent by another tenant makes that
-- tenant's own row, never a collision with this one, and a run can only
-- reference a chat of its own business. A run with no session — Telegram,
-- a routine, an ingest — is the business's, readable by every member.
create table if not exists chat_session (
  id           uuid not null,
  business_id  uuid not null references business(id) on delete cascade,
  created_by   uuid not null references app_user(id) on delete cascade,
  title        text check (char_length(title) <= 200),
  created_at   timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  primary key (business_id, id)
);

create index if not exists idx_chat_session_owner
  on chat_session (business_id, created_by, last_at desc);

alter table chat_session enable row level security;
alter table chat_session force row level security;
drop policy if exists chat_session_tenant on chat_session;
create policy chat_session_tenant on chat_session
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

alter table run add column if not exists session_id uuid;
alter table run drop constraint if exists run_session_fk;
alter table run add constraint run_session_fk
  foreign key (business_id, session_id) references chat_session (business_id, id);
create index if not exists idx_run_session
  on run (business_id, session_id) where session_id is not null;
