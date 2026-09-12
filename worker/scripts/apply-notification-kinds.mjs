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
  new URL('../migrations/037_notification_kinds.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select (select pg_get_constraintdef(oid) from pg_constraint
                where conrelid = 'public.notification'::regclass and conname = 'notification_kind_check') as check_def`;
    if (!row.check_def || !row.check_def.includes(`'work_needs_you'`) || !row.check_def.includes(`'approval_requested'`)) {
      throw new Error(`notification kinds migration verification failed: check is ${row.check_def}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '037_notification_kinds', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
