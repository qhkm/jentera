-- Which door a session came through, and a way to end all of someone's.
--
-- A web session is an HttpOnly cookie: script cannot read it, and it dies
-- with the browser profile. A native session is a bearer the app keeps in
-- Keychain or Keystore and sends in a header — portable, readable by the code
-- holding it, and surviving an uninstall on iOS. They are not the same risk
-- and must be distinguishable after a leak.
alter table session add column if not exists kind text not null default 'web'
  check (kind in ('web', 'native'));

-- Named for a person, not for the machine: "Qaiyyum's iPhone", once there is
-- a devices list to show it in. Null until then.
alter table session add column if not exists device_label text
  check (device_label is null or char_length(device_label) <= 80);
alter table session add column if not exists last_seen_at timestamptz;

create index if not exists idx_session_user_kind on session (user_id, kind)
  where revoked_at is null;

-- Ending every session a person holds, by address.
--
-- revokeSession only revokes the token presented, and the operator connection
-- is read only by design (`default_transaction_read_only`), so before this
-- there was no way to revoke a leaked native bearer at all — not from the app,
-- not by hand. Security definer because `session` and `app_user` are reached
-- outside a tenant transaction, like the other cross-tenant helpers.
--
-- Returns the number of sessions ended so the caller can tell "revoked four"
-- from "that address has nothing open".
--
-- NOT callable through scripts/stats.sh: that connection sets
-- `default_transaction_read_only` on purpose and this writes. Revoking needs a
-- writable owner connection —
--   psql "$(neonctl connection-string --role-name neondb_owner)" \
--     -c "select public.revoke_sessions_for_email('them@example.com')"
-- and aisar_app is deliberately not granted execute: a compromised worker must
-- not be able to sign an estate out.
create or replace function public.revoke_sessions_for_email(target text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update session s
     set revoked_at = now()
    from app_user u
   where u.id = s.user_id
     and lower(u.email) = lower(target)
     and s.revoked_at is null;
  get diagnostics affected = row_count;
  return affected;
end
$$;

revoke all on function public.revoke_sessions_for_email(text) from public;

-- Nothing queries native_auth_code by user_id: the row is addressed by the
-- hash of the code and by nothing else. The index in 044 was dead weight on
-- every insert.
drop index if exists idx_native_auth_code_user;
