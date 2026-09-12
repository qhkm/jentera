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
  new URL('../migrations/038_team_plan_gate.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select has_function_privilege('aisar_app', 'public.business_plan(uuid)', 'execute') as fn_grant,
             (select prosecdef from pg_proc where proname = 'business_plan' and pronamespace = 'public'::regnamespace) as definer`;
    if (!row.fn_grant || !row.definer) throw new Error('team plan gate migration verification failed');
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '038_team_plan_gate', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
