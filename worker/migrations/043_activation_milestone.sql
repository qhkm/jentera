-- Authenticated, content-free launch milestones that cannot be reconstructed
-- from durable product state. A row records only that an owner opened the
-- installed PWA; it never stores prompts, URLs, business content or devices.
create table if not exists activation_milestone (
  business_id   uuid not null references business(id) on delete cascade,
  user_id       uuid not null references app_user(id) on delete cascade,
  kind          text not null check (kind in ('installed_app_opened')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (business_id, user_id, kind)
);

create index if not exists idx_activation_milestone_user
  on activation_milestone (business_id, user_id, first_seen_at);

alter table activation_milestone enable row level security;
alter table activation_milestone force row level security;
drop policy if exists activation_milestone_tenant on activation_milestone;
create policy activation_milestone_tenant on activation_milestone
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

grant select, insert, update on activation_milestone to aisar_app;
revoke delete, truncate, references, trigger on activation_milestone from aisar_app;
