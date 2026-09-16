-- Pre-tenant, verified-account entitlement, like platform_access/session.
-- Lifetime allowance: never reset by a new chat, business or billing month.
create table if not exists chat_preview_account (
  user_id uuid primary key references app_user(id),
  requests_used integer not null default 0 check (requests_used between 0 and 10),
  created_at timestamptz not null default now()
);
create table if not exists chat_preview_request (
  user_id uuid not null references chat_preview_account(user_id),
  request_id uuid not null,
  business_id uuid not null references business(id),
  run_id uuid references run(id),
  task_id uuid references runtime_task(id),
  status text not null default 'reserved' check (status in ('reserved', 'created', 'failed')),
  created_at timestamptz not null default now(),
  primary key (user_id, request_id),
  check (status <> 'created' or (run_id is not null and task_id is not null))
);
create index if not exists chat_preview_task_idx on chat_preview_request (business_id, task_id) where status='created';
-- 000's default privileges include DELETE. Remove it explicitly: no quota
-- reset by deleting an entitlement/ledger row through the application role.
revoke delete on chat_preview_account, chat_preview_request from aisar_app;
grant select, insert, update on chat_preview_account, chat_preview_request to aisar_app;

create or replace function chat_preview_no_reset() returns trigger language plpgsql as $$
begin
  if new.user_id <> old.user_id or new.requests_used < old.requests_used then
    raise exception 'A lifetime chat allowance cannot be reset';
  end if;
  return new;
end;
$$;
drop trigger if exists chat_preview_no_reset on chat_preview_account;
create trigger chat_preview_no_reset before update on chat_preview_account
  for each row execute function chat_preview_no_reset();
