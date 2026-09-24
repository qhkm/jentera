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
  new URL('../migrations/069_work_finished_notification.sql', import.meta.url),
  'utf8',
);
/* Every kind the app and Worker may write. The check is replaced whole, so
   one missing here would start refusing inserts of that kind. */
const kinds = [
  'routine_completed', 'routine_failed', 'routine_skipped', 'routine_needs_approval',
  'work_needs_you', 'approval_requested', 'reminder_due', 'booking_requested', 'work_finished',
];
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select (select pg_get_constraintdef(oid) from pg_constraint
                where conrelid = 'public.notification'::regclass and conname = 'notification_kind_check') as check_def`;
    const missing = kinds.filter((kind) => !row.check_def?.includes(`'${kind}'`));
    if (missing.length) {
      throw new Error(`work_finished migration verification failed: missing ${missing.join(', ')} in ${row.check_def}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '069_work_finished_notification', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
