-- Personal reminders share the durable notification + push outbox pipeline.
create table if not exists reminder (
  id uuid primary key,
  business_id uuid not null references business(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  due_at timestamptz not null,
  time_zone text not null check (time_zone = 'Asia/Kuala_Lumpur'),
  status text not null default 'scheduled' check (status in ('scheduled','sent','cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists reminder_due on reminder(due_at) where status = 'scheduled';
alter table reminder enable row level security;
alter table reminder force row level security;
drop policy if exists reminder_tenant on reminder;
create policy reminder_tenant on reminder
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);
grant select, insert, update on reminder to aisar_app;

create or replace function public.reminder_due_targets(p_now timestamptz, p_limit integer default 50)
returns table (business_id uuid, reminder_id uuid)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select r.business_id, r.id from public.reminder r
  where r.status = 'scheduled' and r.due_at <= p_now
  order by r.due_at, r.id limit greatest(1, least(p_limit, 200))
$$;
revoke all on function public.reminder_due_targets(timestamptz, integer) from public;
grant execute on function public.reminder_due_targets(timestamptz, integer) to aisar_app;

alter table notification drop constraint if exists notification_kind_check;
alter table notification add constraint notification_kind_check check (kind in (
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'reminder_due'
));
