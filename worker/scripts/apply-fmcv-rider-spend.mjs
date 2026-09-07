#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const expectedHost = 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech';
const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');

const target = new URL(connection);
if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
  throw new Error('AISAR_NEON_OWNER_URL must be PostgreSQL');
}
if (target.hostname !== expectedHost || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(
  new URL('../migrations/020_fmcv_rider_spend.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        to_regclass('public.fmcv_rider_spend') is not null as ledger_table,
        (select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'fmcv_rider_spend')::int >= 3 as policies,
        (select count(*) > 0 from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'fmcv_rider_spend'
            and grantee = 'aisar_app' and privilege_type = 'INSERT') as app_insert,
        (select count(*) > 0 from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'fmcv_rider_spend'
            and grantee = 'aisar_app' and privilege_type = 'UPDATE') as app_update,
        (select count(*) > 0 from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'fmcv_rider_spend'
            and grantee = 'aisar_app' and privilege_type = 'SELECT') as app_select`;
    const keys = ['ledger_table', 'policies', 'app_insert', 'app_update', 'app_select'];
    for (const key of keys) {
      if (!row[key]) throw new Error(`fmcv_rider_spend migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '020_fmcv_rider_spend', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
