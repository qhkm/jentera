alter table specialist_profile add column if not exists avatar text not null default 'original'
  check (avatar in ('original','wing','operator','cat','cube','blue','yellow','pink','purple','orange'));

-- Personal choice within a business; roles and avatars remain owner-managed.
create table if not exists bot_preference (
  business_id uuid not null references business(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  default_profile text not null default 'default',
  coordinator_avatar text not null default 'original'
    check (coordinator_avatar in ('original','wing','operator','cat','cube','blue','yellow','pink','purple','orange')),
  primary key (business_id, user_id)
);
alter table bot_preference enable row level security;
alter table bot_preference force row level security;
drop policy if exists bot_preference_tenant on bot_preference;
create policy bot_preference_tenant on bot_preference
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid)
  with check (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update, delete on bot_preference to aisar_app;
