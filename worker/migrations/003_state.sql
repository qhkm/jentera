-- Slice 1, task 5: the tenant-scoped state the Repository interface persists.
--
-- Every table here carries business_id and an RLS policy from the start.
-- Adding the policy later is how a table ends up shipping without one.
-- Idempotent.

create table if not exists approval (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  connector     text not null,
  op            text not null,
  args          jsonb not null,
  -- what AISAR proposed, when the owner edited before approving. The
  -- delta between this and args is the strongest correction signal the
  -- product gets, and the easiest to lose.
  args_original jsonb,
  risk          text not null check (risk in ('low','medium','high')),
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','executed','failed','expired')),
  expires_at    timestamptz,
  decided_by    uuid references app_user(id),
  decided_at    timestamptz,
  result        jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists action_policy (
  business_id uuid not null references business(id) on delete cascade,
  op          text not null,
  policy      text not null check (policy in ('automatic','approval','blocked')),
  updated_by  uuid references app_user(id),
  updated_at  timestamptz not null default now(),
  primary key (business_id, op)
);

create table if not exists work_done (
  business_id  uuid not null references business(id) on delete cascade,
  playbook_key text not null,
  idx          text not null,   -- string, matching what the old engine wrote
  done_at      timestamptz not null default now(),
  primary key (business_id, playbook_key, idx)
);

create table if not exists learn (
  business_id  uuid not null references business(id) on delete cascade,
  playbook_key text not null,
  pick         text not null,
  count        integer not null default 1,
  primary key (business_id, playbook_key, pick)
);

create index if not exists idx_approval_pending
  on approval (business_id, status, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['approval','action_policy','work_done','learn'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format(
      'create policy %I on %I using (business_id = nullif(current_setting(''app.business_id'', true), '''')::uuid)',
      t || '_tenant', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
