-- A one-time code handed to the native app through the system browser.
--
-- Only its SHA-256 is stored. It expires in one minute and is spent through
-- a conditional update, like login_token but with a much shorter hand-off.
-- The source session, state, and PKCE S256 challenge bind the callback to the
-- browser session and to the app instance that began the attempt.
create table if not exists native_auth_code (
  id             text primary key,
  user_id        uuid not null references app_user(id) on delete cascade,
  session_id     text not null references session(id) on delete cascade,
  code_challenge text not null check (char_length(code_challenge) between 43 and 128),
  state          text not null check (char_length(state) between 16 and 128),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_native_auth_code_user
  on native_auth_code (user_id);

grant select, insert, update, delete on native_auth_code to aisar_app;
