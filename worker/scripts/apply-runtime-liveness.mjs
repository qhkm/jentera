#!/usr/bin/env node
/* Applies 047_runtime_liveness.sql. Idempotent (create or replace). */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
const ALLOWED_HOSTS = new Set([
  'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech',
]);
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    !ALLOWED_HOSTS.has(target.hostname) ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}
const migration = await readFile(new URL('../migrations/047_runtime_liveness.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select to_regprocedure('public.runtime_liveness()') is not null as fn_ok,
             has_function_privilege('aisar_app', 'public.runtime_liveness()', 'execute') as app_can_read`;
    if (!row.fn_ok) throw new Error('runtime_liveness missing after apply');
    if (!row.app_can_read) throw new Error('aisar_app must be able to call runtime_liveness');
    const [live] = await tx`select * from public.runtime_liveness()`;
    return { ...row, live };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '047_runtime_liveness', verified })}\n`);
} finally {
  await sql.end();
}
