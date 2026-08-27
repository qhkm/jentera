/* ============================================================
   Hard per-business ceilings and terminal task failure.

   Provider invoices and model-key limits are outer circuit breakers.
   These rows are AISAR's tenant-scoped source of truth, checked before
   compute is woken and reconciled with measured usage at completion.
   ============================================================ */

alter table runtime_task drop constraint if exists runtime_task_status_check;
alter table runtime_task add constraint runtime_task_status_check
  check (status in ('queued','leased','completed','failed','cancelled','exhausted'));

alter table runtime_task drop constraint if exists runtime_task_kind_check;
alter table runtime_task add constraint runtime_task_kind_check
  check (kind in ('provision','run','resume','reconcile','upgrade','delete','cancel'));

create table if not exists runtime_budget (
  business_id              uuid primary key references business(id) on delete cascade,
  monthly_input_tokens     bigint not null default 2000000 check (monthly_input_tokens > 0),
  monthly_output_tokens    bigint not null default 500000 check (monthly_output_tokens > 0),
  monthly_runtime_seconds  bigint not null default 360000 check (monthly_runtime_seconds > 0),
  monthly_cost_microusd    bigint not null default 5000000 check (monthly_cost_microusd > 0),
  max_run_seconds          int not null default 900 check (max_run_seconds between 10 and 3600),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists runtime_usage (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references business(id) on delete cascade,
  runtime_task_id          uuid not null unique references runtime_task(id) on delete cascade,
  status                   text not null default 'reserved'
                           check (status in ('reserved','completed','failed','cancelled')),
  reserved_input_tokens    bigint not null check (reserved_input_tokens >= 0),
  reserved_output_tokens   bigint not null check (reserved_output_tokens >= 0),
  input_tokens             bigint not null default 0 check (input_tokens >= 0),
  output_tokens            bigint not null default 0 check (output_tokens >= 0),
  runtime_ms               bigint not null default 0 check (runtime_ms >= 0),
  cost_microusd            bigint not null default 0 check (cost_microusd >= 0),
  model                    text not null,
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_runtime_usage_month
  on runtime_usage (business_id, started_at);

alter table runtime_budget enable row level security;
alter table runtime_budget force row level security;
drop policy if exists runtime_budget_tenant on runtime_budget;
create policy runtime_budget_tenant on runtime_budget
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

alter table runtime_usage enable row level security;
alter table runtime_usage force row level security;
drop policy if exists runtime_usage_tenant on runtime_usage;
create policy runtime_usage_tenant on runtime_usage
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);
