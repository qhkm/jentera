/* ============================================================
   Two more ways into the same account.

   Until now an account was defined entirely by "can receive mail at
   this address". Adding a password and a Google identity means one
   person can now hold several credentials, and the interesting part is
   not storing them — it is deciding when two credentials are the same
   person.

   `email_verified` is what makes that decision safe. Without it the
   flow is pre-hijackable: an attacker signs up with a password on an
   address they do not own, the real owner later arrives via Google, the
   two get linked on matching email, and the attacker's password still
   opens the account. So a password alone never proves ownership —
   only consuming a link sent to the address, or Google asserting it,
   does.
   ============================================================ */

-- Nullable on purpose: every existing account arrived by magic link and
-- has no password, which is a permanent, supported state rather than a
-- migration to finish.
alter table app_user add column if not exists password_hash text;

/* False by default, which is the safe direction for anyone created by a
   future code path that forgets to think about it. The magic-link
   consume sets it true, because receiving the link is the proof. */
alter table app_user add column if not exists email_verified boolean not null default false;

/* Every account that exists today got here by consuming a link, so each
   has already demonstrated control of its address. Marking them false
   would lock out real users the moment password login starts checking
   this column. */
update app_user set email_verified = true where email_verified = false;

create table if not exists oauth_identity (
  provider   text not null,
  -- Google's `sub`. Stable for the life of the account and, unlike the
  -- email address, never reassigned or changed by the user — which is
  -- why the identity is keyed on it rather than on email.
  subject    text not null,
  user_id    uuid not null references app_user(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index if not exists idx_oauth_identity_user on oauth_identity (user_id);

/* No RLS on either. Both are read while resolving who the caller is,
   which is strictly before any business_id exists to scope them by —
   the same reason app_user, session and login_token carry none. */
