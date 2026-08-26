/* ============================================================
   Connections to the outside world, and the secrets that open them.

   Two tables rather than one, and the split is the point: `connection`
   is metadata anyone debugging the product may need to see — which
   connector, whose account, working or broken. `credential` is the
   secret itself, encrypted, and nothing routine ever reads it.

   Keeping them apart means the status screen, the connector list and
   every diagnostic query touch a table with no secret in it at all.
   ============================================================ */

create table if not exists connection (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  connector    text not null,
  -- 'bot_token' | 'business_connection' | 'oauth'. Recorded because it
  -- decides how the credential is used and refreshed, and because
  -- Telegram offers two routes with different trade-offs; storing the
  -- choice keeps switching a data change rather than a rewrite.
  method       text not null,
  status       text not null check (status in ('connected','expired','revoked','error')),
  -- The account on the far side: a bot id, a page id, a workspace id.
  external_id  text,
  display_name text,
  scopes       text[],
  connected_by uuid references app_user(id),
  connected_at timestamptz not null default now(),
  last_ok_at   timestamptz,
  -- Why a broken connection is broken, in words the owner can act on.
  last_error   text,
  unique (business_id, connector, external_id)
);

create index if not exists idx_connection_business
  on connection (business_id, connector);

create table if not exists credential (
  connection_id uuid primary key references connection(id) on delete cascade,
  -- AES-GCM. The random IV is prefixed to the ciphertext rather than
  -- stored beside it: they are useless apart and impossible to
  -- mismatch when they travel as one value.
  ciphertext    bytea not null,
  -- Which key encrypted this. Rotation writes new rows at the next
  -- version while old ones stay readable, so a key can be retired
  -- without a flag day.
  key_version   int not null default 1,
  expires_at    timestamptz,
  refreshed_at  timestamptz,
  created_at    timestamptz not null default now()
);

/* RLS on both. `credential` has no business_id of its own — it hangs
   off the connection — so its policy reaches through. A credential is
   readable exactly when its connection is. */
alter table connection enable row level security;
alter table connection force row level security;
drop policy if exists connection_tenant on connection;
create policy connection_tenant on connection
  using (business_id = (nullif(current_setting('app.business_id', true), ''))::uuid);

alter table credential enable row level security;
alter table credential force row level security;
drop policy if exists credential_tenant on credential;
create policy credential_tenant on credential
  using (
    connection_id in (
      select id from connection
       where business_id = (nullif(current_setting('app.business_id', true), ''))::uuid
    )
  );
