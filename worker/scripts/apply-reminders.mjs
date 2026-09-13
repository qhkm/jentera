import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech' ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('Connection does not match the reviewed production owner target');
}
const migration = await readFile(new URL('../migrations/040_reminders.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async tx => {
    await tx.unsafe(migration);
    const [row] = await tx`select
      (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.reminder'::regclass) as forced_rls,
      (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'reminder' and policyname = 'reminder_tenant') as tenant_policy,
      has_table_privilege('aisar_app', 'public.reminder', 'select,insert,update') as app_grants,
      has_function_privilege('aisar_app', 'public.reminder_due_targets(timestamptz,integer)', 'execute') as scheduler_access,
      (select pg_get_constraintdef(oid) like '%reminder_due%' from pg_constraint where conrelid = 'public.notification'::regclass and conname = 'notification_kind_check') as notification_kind`;
    if (!Object.values(row).every(value => value === true)) throw new Error('Reminder migration verification failed');
    return row;
  });
  console.log(JSON.stringify({ ok: true, migration: '040_reminders', verified }));
} finally { await sql.end({ timeout: 5 }); }
