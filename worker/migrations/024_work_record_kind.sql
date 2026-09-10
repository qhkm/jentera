-- A work record is either work or conversation. Every durable run used to
-- become a "task" for the owner: a card in the chat and a row in Activity,
-- even for "yo". A quick reply the agent answered without a tool is
-- conversation; deep mode or any tool use is work. History stays 'work':
-- tool use was not recorded before 2026-09-10, so it cannot be told apart.
alter table work_record
  add column if not exists kind text not null default 'work'
    check (kind in ('work', 'conversation'));

create index if not exists idx_work_record_kind
  on work_record (business_id, kind, occurred_at desc);
