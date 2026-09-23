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

// Exactly what the routes use, per table — not "any of these", since
// has_table_privilege(role, table, 'select,insert,update') is satisfied by
// ANY listed privilege, so a combined check would pass even with an
// excess grant (e.g. DELETE) sitting alongside it undetected.
const TABLES = {
  app_installation: ['select', 'insert', 'update'],
  app_slug: ['select', 'insert'],
  booking_settings: ['select', 'insert', 'update'],
  booking_service: ['select', 'insert', 'update', 'delete'],
  booking_hours: ['select', 'insert', 'update', 'delete'],
  booking: ['select', 'insert', 'update'],
  booking_calendar_job: ['select', 'insert', 'update'],
};
const ALL_PRIVILEGES = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];

const migration = await readFile(new URL('../migrations/068_apps_bookings.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const checks = {};
    for (const [table, expected] of Object.entries(TABLES)) {
      const [row] = await tx`
        select
          (select relrowsecurity and relforcerowsecurity from pg_class
            where oid = ${'public.' + table}::regclass) as forced_rls,
          (select count(*) = 1 from pg_policies
            where schemaname = 'public' and tablename = ${table}
              and policyname = ${table + '_tenant'}
              and qual is not null and with_check is not null) as tenant_policy`;
      if (!row.forced_rls) throw new Error(`apps migration verification failed: ${table}.forced_rls`);
      if (!row.tenant_policy) throw new Error(`apps migration verification failed: ${table}.tenant_policy`);
      const held = {};
      for (const privilege of ALL_PRIVILEGES) {
        const [priv] = await tx`
          select has_table_privilege('aisar_app', ${'public.' + table}, ${privilege}) as ok`;
        held[privilege] = priv.ok;
      }
      for (const privilege of ALL_PRIVILEGES) {
        if (held[privilege] !== expected.includes(privilege)) {
          throw new Error(`apps migration verification failed: ${table}.${privilege} is ${held[privilege]}, expected ${expected.includes(privilege)}`);
        }
      }
      checks[table] = { ...row, app_grants: held };
    }
    const [fn] = await tx`
      select
        has_function_privilege('aisar_app', 'public.bookings_by_slug(text)', 'execute') as slug_fn,
        pg_get_function_result('public.bookings_by_slug(text)'::regprocedure) as slug_fn_result,
        has_function_privilege('aisar_app', 'public.booking_calendar_due(timestamptz, integer)', 'execute') as due_fn,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'notification' and column_name = 'url') as notification_url,
        (select pg_get_constraintdef(oid) like '%booking_requested%' from pg_constraint
          where conrelid = 'public.notification'::regclass and conname = 'notification_kind_check') as booking_kind,
        (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'public.notification'::regclass and conname = 'notification_url_check') as url_check_def`;
    for (const key of ['slug_fn', 'due_fn', 'notification_url', 'booking_kind']) {
      if (!fn[key]) throw new Error(`apps migration verification failed: ${key}`);
    }
    if (fn.slug_fn_result !== 'TABLE(business_id uuid, current_slug text)') {
      throw new Error(`apps migration verification failed: bookings_by_slug returns ${fn.slug_fn_result}`);
    }
    if (!fn.url_check_def || !fn.url_check_def.includes('300') || !fn.url_check_def.includes('^/app([/?#]|$)')) {
      throw new Error('apps migration verification failed: notification_url_check does not carry the expected pattern and length bound');
    }

    // Both security definers: definer rights, the search_path 068 pins, and
    // no EXECUTE for PUBLIC (a function is executable by PUBLIC by default).
    const definers = {};
    for (const signature of ['public.bookings_by_slug(text)', 'public.booking_calendar_due(timestamptz, integer)']) {
      const [row] = await tx`
        select p.prosecdef as definer,
               coalesce(p.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, public, pg_temp'] as search_path,
               has_function_privilege('public', ${signature}::regprocedure, 'execute') as public_execute
          from pg_proc p where p.oid = ${signature}::regprocedure`;
      if (!row?.definer) throw new Error(`apps migration verification failed: ${signature} is not security definer`);
      if (!row.search_path) throw new Error(`apps migration verification failed: ${signature} search_path is not pinned`);
      if (row.public_execute) throw new Error(`apps migration verification failed: PUBLIC can execute ${signature}`);
      definers[signature] = row;
    }
    const [more] = await tx`
      select
        position('attempts >= 8' in
          pg_get_functiondef('public.booking_calendar_due(timestamptz, integer)'::regprocedure)) > 0 as orphan_clause,
        (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'public.notification'::regclass and conname = 'notification_kind_check') as kind_check_def,
        (select string_agg(column_name::text, ',' order by column_name) from information_schema.columns
          where table_schema = 'public' and table_name = 'booking'
            and column_name in ('calendar_account', 'calendar_account_label', 'calendar_reason')) as calendar_columns`;
    if (!more.orphan_clause) {
      throw new Error('apps migration verification failed: booking_calendar_due has no orphan clause (attempts >= 8)');
    }
    // 069 on main adds work_finished; whichever migration runs last must keep both kinds.
    for (const kind of ['booking_requested', 'work_finished']) {
      if (!more.kind_check_def?.includes(kind)) {
        throw new Error(`apps migration verification failed: notification_kind_check does not admit ${kind}`);
      }
    }
    // A string, not an array: this connection runs with fetch_types off, so arrays are not parsed.
    if (more.calendar_columns !== 'calendar_account,calendar_account_label,calendar_reason') {
      throw new Error(`apps migration verification failed: booking calendar columns are ${more.calendar_columns}`);
    }
    return { ...checks, ...fn, definers, ...more };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '068_apps_bookings', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
