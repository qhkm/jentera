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
if ((target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') ||
    !allowedHosts.has(target.hostname) || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const TABLES = {
  app_installation: 'select,insert,update',
  booking_settings: 'select,insert,update',
  booking_service: 'select,insert,update,delete',
  booking_hours: 'select,insert,update,delete',
  booking: 'select,insert,update',
  booking_calendar_job: 'select,insert,update',
};

const migration = await readFile(new URL('../migrations/068_apps_bookings.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const checks = {};
    for (const [table, privileges] of Object.entries(TABLES)) {
      const [row] = await tx`
        select
          (select relrowsecurity and relforcerowsecurity from pg_class
            where oid = ${'public.' + table}::regclass) as forced_rls,
          (select count(*) = 1 from pg_policies
            where schemaname = 'public' and tablename = ${table}
              and policyname = ${table + '_tenant'}
              and qual is not null and with_check is not null) as tenant_policy,
          has_table_privilege('aisar_app', ${'public.' + table}, ${privileges}) as app_grants`;
      for (const key of ['forced_rls', 'tenant_policy', 'app_grants']) {
        if (!row[key]) throw new Error(`apps migration verification failed: ${table}.${key}`);
      }
      checks[table] = row;
    }
    const [fn] = await tx`
      select
        has_function_privilege('aisar_app', 'public.bookings_by_slug(text)', 'execute') as slug_fn,
        has_function_privilege('aisar_app', 'public.booking_calendar_due(timestamptz, integer)', 'execute') as due_fn,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'notification' and column_name = 'url') as notification_url,
        (select pg_get_constraintdef(oid) like '%booking_requested%' from pg_constraint
          where conrelid = 'public.notification'::regclass and conname = 'notification_kind_check') as booking_kind`;
    for (const key of ['slug_fn', 'due_fn', 'notification_url', 'booking_kind']) {
      if (!fn[key]) throw new Error(`apps migration verification failed: ${key}`);
    }
    return { ...checks, ...fn };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '068_apps_bookings', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
