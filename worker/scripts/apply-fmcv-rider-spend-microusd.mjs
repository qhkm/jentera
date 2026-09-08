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
  new URL('../migrations/021_fmcv_rider_spend_microusd.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) > 0 from information_schema.columns
          where table_schema = 'public' and table_name = 'fmcv_rider_spend'
            and column_name = 'spend_microusd' and data_type = 'bigint') as microusd_column,
        (select coalesce(bool_and(spend_microusd >= spend_usd_cents::bigint * 10000), true)
           from public.fmcv_rider_spend) as balances_carried`;
    const keys = ['microusd_column', 'balances_carried'];
    for (const key of keys) {
      if (!row[key]) throw new Error(`fmcv_rider_spend microusd migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '021_fmcv_rider_spend_microusd', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
