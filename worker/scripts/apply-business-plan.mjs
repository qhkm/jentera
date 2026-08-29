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
  new URL('../migrations/016_business_plan.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'business'
            and column_name = 'plan') is not null as plan_column,
        (select count(*) > 0 from information_schema.check_constraints cc
          join pg_constraint c on c.conname = cc.constraint_name
          join pg_class r on r.oid = c.conrelid
         where r.relname = 'business' and pg_get_constraintdef(c.oid) like '%pro%') as plan_check`;
    if (!row.plan_column || !row.plan_check) {
      throw new Error('business plan migration verification failed');
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '016_business_plan', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
