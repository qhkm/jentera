-- Business goals are durable outcomes, not chat messages. Work started from
-- a goal links through run.goal_id so progress can be shown from real task
-- evidence without asking a model to invent a percentage.
create table if not exists goal (
  id               uuid not null default gen_random_uuid(),
  business_id      uuid not null references business(id) on delete cascade,
  created_by       uuid references app_user(id) on delete set null,
  title            text not null check (char_length(title) between 1 and 120),
  success_criteria text not null check (char_length(success_criteria) between 1 and 1000),
  target_date      date,
  status           text not null default 'active'
                   check (status in ('active', 'completed', 'archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  primary key (business_id, id)
);

create index if not exists idx_goal_business_status
  on goal (business_id, status, updated_at desc);

alter table goal enable row level security;
alter table goal force row level security;
drop policy if exists goal_tenant on goal;
create policy goal_tenant on goal
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

grant select, insert, update on goal to aisar_app;

alter table run add column if not exists goal_id uuid;
alter table run drop constraint if exists run_goal_fk;
alter table run add constraint run_goal_fk
  foreign key (business_id, goal_id) references goal (business_id, id);
create index if not exists idx_run_goal
  on run (business_id, goal_id, created_at desc) where goal_id is not null;
