#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
const allowedHosts = new Set([
  'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech',
]);
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    !allowedHosts.has(target.hostname) || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(new URL('../migrations/050_vault_connection.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'connection'
            and column_name = 'vault_secret_id' and data_type = 'uuid') as column_present,
        to_regclass('public.idx_connection_vault_secret') is not null as index_present`;
    if (!row.column_present || !row.index_present) {
      throw new Error('vault connection migration verification failed');
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '050_vault_connection', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
