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
const migration = await readFile(new URL('../migrations/039_fact_proposals.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select exists (select 1 from information_schema.columns where table_schema = 'public'
        and table_name = 'business_fact' and column_name = 'pending' and is_nullable = 'NO') as column_ok,
        exists (select 1 from pg_index where indexrelid = 'business_fact_pending'::regclass
          and indisunique and indisvalid) as index_ok,
        (select relforcerowsecurity from pg_class where oid = 'business_fact'::regclass) as rls_ok`;
    if (!row.column_ok || !row.index_ok || !row.rls_ok) throw new Error('fact proposal migration verification failed');
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '039_fact_proposals', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
