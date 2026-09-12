#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const expectedHost = 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech';
const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
if ((target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') ||
    target.hostname !== expectedHost || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(
  new URL('../migrations/033_business_plan_team.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'public.business'::regclass and conname = 'business_plan_check') as check_def,
        (select count(*)::int from business where plan not in ('free', 'pro', 'team')) as stray_plans`;
    if (!row.check_def || !row.check_def.includes(`'team'`)) {
      throw new Error(`team plan migration verification failed: check is ${row.check_def}`);
    }
    if (row.stray_plans !== 0) throw new Error('team plan migration verification failed: stray plans');
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '033_business_plan_team', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
