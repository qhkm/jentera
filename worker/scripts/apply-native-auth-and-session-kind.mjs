#!/usr/bin/env node
/* Applies 044_native_auth_code.sql and 046_session_kind.sql together.
   Both were committed on 15 September and neither reached production; the
   deploy dispatcher's migration check is what surfaced that. Both are
   idempotent (`if not exists`, `create or replace`), so a re-run is safe. */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
/* Both spellings of the same endpoint. The older apply scripts hardcode the
   pooler host, but `neonctl connection-string` hands back the direct one, and
   direct is the better choice for DDL in a transaction anyway. Anything else
   is refused: this script writes to production. */
const ALLOWED_HOSTS = new Set([
  'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech',
]);
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    !ALLOWED_HOSTS.has(target.hostname) ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const read = (name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const nativeAuthCode = await read('044_native_auth_code.sql');
const sessionKind = await read('046_session_kind.sql');

const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(nativeAuthCode);
    await tx.unsafe(sessionKind);
    const [row] = await tx`
      select
        to_regclass('public.native_auth_code') is not null as code_table_ok,
        has_table_privilege('aisar_app', 'native_auth_code', 'select,insert,update,delete') as code_grants_ok,
        (select count(*) from information_schema.columns
          where table_name = 'session'
            and column_name in ('kind', 'device_label', 'last_seen_at'))::int as session_columns,
        to_regprocedure('public.revoke_sessions_for_email(text)') is not null as revoke_ok,
        has_function_privilege('aisar_app', 'public.revoke_sessions_for_email(text)', 'execute') as app_can_revoke`;
    if (!row.code_table_ok) throw new Error('native_auth_code missing after apply');
    if (!row.code_grants_ok) throw new Error('aisar_app lacks grants on native_auth_code');
    if (row.session_columns !== 3) throw new Error(`session gained ${row.session_columns} of 3 columns`);
    if (!row.revoke_ok) throw new Error('revoke_sessions_for_email missing after apply');
    /* Deliberate: mass revocation is an operator tool. A compromised worker
       must not be able to sign an estate out. */
    if (row.app_can_revoke) throw new Error('aisar_app must NOT hold execute on revoke_sessions_for_email');
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migrations: ['044_native_auth_code', '046_session_kind'], verified })}\n`);
} finally {
  await sql.end();
}
