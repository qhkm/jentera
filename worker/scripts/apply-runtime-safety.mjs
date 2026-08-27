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
  new URL('../migrations/015_runtime_safety.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        to_regclass('public.runtime_budget')::text as budgets,
        to_regclass('public.runtime_usage')::text as usage,
        pg_get_constraintdef((
          select oid from pg_constraint
           where conrelid = 'runtime_task'::regclass and conname = 'runtime_task_status_check'
        )) like '%exhausted%' as exhausted,
        pg_get_constraintdef((
          select oid from pg_constraint
           where conrelid = 'runtime_task'::regclass and conname = 'runtime_task_kind_check'
        )) like '%cancel%' as cancellation,
        (
          select count(*) = 5 from information_schema.columns
           where table_schema = 'public' and table_name = 'agent_runtime'
             and column_name in (
               'model_key_ciphertext', 'model_key_version', 'model_key_hash',
               'model_key_expires_at', 'model_key_pending_revocation_hash'
             )
        ) as model_key_rotation`;
    if (row.budgets !== 'runtime_budget' || row.usage !== 'runtime_usage' ||
        !row.exhausted || !row.cancellation || !row.model_key_rotation) {
      throw new Error('runtime safety migration verification failed');
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '015_runtime_safety', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
