/* ============================================================
   Rate-limit ledger for the magic-link endpoint.

   /api/auth/request is unauthenticated and now sends real email on
   every call, so the only thing standing between an attacker and
   jentera.ai's sending reputation is this table plus the edge burst
   limiter. The previous brake was MAX_OUTSTANDING in auth.ts, which
   caps concurrent unconsumed tokens per address — since tokens expire
   in 15 minutes that permitted roughly 288 sends per address per day,
   and nothing at all across different addresses.

   No RLS, deliberately. Like app_user, session and login_token, this
   is read before any tenant is known — there is no business_id to
   scope it by.
   ============================================================ */

create table if not exists auth_attempt (
  -- Identity rather than bigserial: bigserial's sequence needs a
  -- separate USAGE grant, and the default privileges on this database
  -- cover tables (arwd to aisar_app) but not sequences. An identity
  -- column's sequence is owned by the column, so INSERT on the table
  -- is the only permission involved.
  id         bigint generated always as identity primary key,
  email      text        not null,
  -- HMAC-SHA256, never the address itself. A plain SHA-256 of an IPv4
  -- is reversible by brute force in seconds (2^32 candidates), so the
  -- hash is keyed by RATE_LIMIT_PEPPER to make the stored value useless
  -- to anyone who reads the table.
  ip_hash    text        not null,
  created_at timestamptz not null default now()
);

-- The two counting predicates. Both are (key, time) so the 24h window
-- is an index range scan rather than a sequential scan of the table.
create index if not exists idx_auth_attempt_email on auth_attempt (email, created_at desc);
create index if not exists idx_auth_attempt_ip    on auth_attempt (ip_hash, created_at desc);
-- Supports the garbage collection sweep, which runs on every request
-- and must stay cheap when there is nothing to delete.
create index if not exists idx_auth_attempt_age   on auth_attempt (created_at);
