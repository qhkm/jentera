-- An owner-defined plan for a goal. Checkpoints are explicit business
-- assertions; Jentera's linked runs provide evidence but never mark a
-- checkpoint complete on the owner's behalf.
create table if not exists goal_checkpoint (
  id           uuid not null default gen_random_uuid(),
  business_id  uuid not null,
  goal_id      uuid not null,
  created_by   uuid references app_user(id) on delete set null,
  title        text not null check (char_length(title) between 1 and 160),
  status       text not null default 'todo'
               check (status in ('todo', 'working', 'blocked', 'completed')),
  position     integer not null check (position >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  primary key (business_id, id),
  unique (business_id, goal_id, id),
  foreign key (business_id, goal_id)
    references goal (business_id, id) on delete cascade
);

create index if not exists idx_goal_checkpoint_order
  on goal_checkpoint (business_id, goal_id, position, created_at);

alter table goal_checkpoint enable row level security;
alter table goal_checkpoint force row level security;
drop policy if exists goal_checkpoint_tenant on goal_checkpoint;
create policy goal_checkpoint_tenant on goal_checkpoint
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

grant select, insert, update on goal_checkpoint to aisar_app;

alter table run add column if not exists goal_checkpoint_id uuid;
alter table run drop constraint if exists run_goal_checkpoint_required;
alter table run add constraint run_goal_checkpoint_required
  check (goal_checkpoint_id is null or goal_id is not null);
alter table run drop constraint if exists run_goal_checkpoint_fk;
alter table run add constraint run_goal_checkpoint_fk
  foreign key (business_id, goal_id, goal_checkpoint_id)
  references goal_checkpoint (business_id, goal_id, id);
create index if not exists idx_run_goal_checkpoint
  on run (business_id, goal_id, goal_checkpoint_id, created_at desc)
  where goal_checkpoint_id is not null;
