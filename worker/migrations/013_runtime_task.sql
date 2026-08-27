/* ============================================================
   Durable work handed to an isolated runtime.

   Cloudflare Queue delivery is at-least-once. This table is the
   durable truth that turns duplicate messages into harmless wakeups,
   and the partial unique index enforces one active task per business.
   ============================================================ */

create table if not exists runtime_task (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references business(id) on delete cascade,
  run_id           uuid references run(id) on delete cascade,
  kind             text not null check (kind in (
                     'provision','run','resume','reconcile','upgrade','delete'
                   )),
  status           text not null default 'queued'
                   check (status in ('queued','leased','completed','failed','cancelled')),
  payload          jsonb not null default '{}',
  dedupe_key       text not null,
  attempt          int not null default 0,
  lease_token      text,
  lease_expires_at timestamptz,
  available_at     timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (business_id, dedupe_key),
  check (
    (status = 'leased' and lease_token is not null and lease_expires_at is not null) or
    (status <> 'leased' and lease_token is null and lease_expires_at is null)
  )
);

create unique index if not exists idx_runtime_task_one_lease
  on runtime_task (business_id) where status = 'leased';

create index if not exists idx_runtime_task_ready
  on runtime_task (status, available_at, created_at)
  where status in ('queued','failed');

alter table runtime_task enable row level security;
alter table runtime_task force row level security;
drop policy if exists runtime_task_tenant on runtime_task;
create policy runtime_task_tenant on runtime_task
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

