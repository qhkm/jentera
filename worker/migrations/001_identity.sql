-- Slice 1, task 2: identity and tenancy.
-- Idempotent. Safe to re-run.

create extension if not exists citext;

create table if not exists app_user (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null unique,
  name         text,
  detail_level text not null default 'beginner'
               check (detail_level in ('beginner','advanced')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists business (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  playbook_key text not null,
  country      text not null default 'MY',
  lang         text not null default 'en' check (lang in ('en','bm')),
  locality     text,
  runtime      text not null default 'aisar-native',
  onboarded    boolean not null default false,
  setup_done   boolean not null default false,
  channels     jsonb not null default '[]',
  connections  jsonb not null default '[]',
  theme        text not null default 'dark' check (theme in ('dark','light')),
  created_at   timestamptz not null default now()
);

create table if not exists membership (
  user_id     uuid not null references app_user(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  role        text not null check (role in ('owner','staff')),
  created_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- session.id holds a SHA-256 of the cookie value, never the raw token:
-- a leaked dump must not yield usable sessions.
create table if not exists session (
  id          text primary key,
  user_id     uuid not null references app_user(id) on delete cascade,
  business_id uuid references business(id) on delete set null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists login_token (
  token_hash  text primary key,
  email       citext not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- `session_user` is a reserved word in Postgres (the SESSION_USER function),
-- so these carry an idx_ prefix rather than the bare table_column form.
create index if not exists idx_session_user on session (user_id) where revoked_at is null;
create index if not exists idx_login_token_email on login_token (email) where consumed_at is null;
