-- Pre-tenant access control, like app_user/session. Not business plan flags.
create table if not exists platform_access (
  email text primary key check (email = lower(email)),
  kind text not null check (kind in ('paid', 'trial')),
  expires_at timestamptz,
  revoked_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (kind <> 'trial' or expires_at is not null)
);
create table if not exists trial_invite (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  email text check (email = lower(email)),
  expires_at timestamptz not null,
  redeemed_by uuid references app_user(id),
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- A trial cannot be restarted with another code, even after revocation.
create table if not exists trial_redemption (
  user_id uuid primary key references app_user(id),
  token_hash text not null unique references trial_invite(token_hash),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists waitlist_entry (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
grant select, insert, update on platform_access, trial_invite to aisar_app;
grant select, insert on trial_redemption, waitlist_entry to aisar_app;
