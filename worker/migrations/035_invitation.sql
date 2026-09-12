-- Invitations: the way a second person joins a business. Until now the
-- only path in created a new business, because onboarding is the only
-- place a membership was ever written.
--
-- An invitation names an address, not a person: whoever signs in through
-- any of the three doors with that verified address may accept it. The
-- token travels only in the email; this table keeps its SHA-256, like a
-- magic link. Acceptance is a conditional UPDATE, so a replayed link
-- matches no row. Only staff can be invited: the founder is the owner.
create table if not exists invitation (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  email        text not null check (email = lower(email) and char_length(email) between 3 and 320),
  role         text not null default 'staff' check (role in ('staff')),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by   uuid not null references app_user(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references app_user(id) on delete set null,
  revoked_at   timestamptz
);

-- One open invitation per address per business; a revoked or accepted
-- one frees the address again.
create unique index if not exists idx_invitation_open_email
  on invitation (business_id, email)
  where accepted_at is null and revoked_at is null;
create index if not exists idx_invitation_business_created
  on invitation (business_id, created_at desc);

alter table invitation enable row level security;
alter table invitation force row level security;
drop policy if exists invitation_tenant on invitation;
create policy invitation_tenant on invitation
  using (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

-- Acceptance arrives with a token and no tenant. Like routine_due_targets
-- (022) and push_outbox_due (031), this returns ids and nothing else;
-- every read and write of the row happens in withTenant.
create or replace function public.invitation_by_token(p_token_hash text)
returns table (id uuid, business_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select i.id, i.business_id
    from public.invitation as i
   where i.token_hash = p_token_hash
   limit 1
$$;

revoke all on function public.invitation_by_token(text) from public;
grant execute on function public.invitation_by_token(text) to aisar_app;
