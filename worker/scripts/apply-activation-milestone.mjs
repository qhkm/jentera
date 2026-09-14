#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    target.hostname !== 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech' ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}
const migration = await readFile(new URL('../migrations/043_activation_milestone.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select to_regclass('public.activation_milestone') is not null as table_ok,
        has_table_privilege('aisar_app', 'activation_milestone', 'select,insert,update') as grants_ok,
        (select relforcerowsecurity from pg_class where oid = 'activation_milestone'::regclass) as rls_ok`;
    if (!row.table_ok || !row.grants_ok || !row.rls_ok) throw new Error('activation milestone migration verification failed');
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '043_activation_milestone', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
