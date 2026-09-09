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

const migration = await readFile(new URL('../migrations/022_routines.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 3 from pg_tables
          where schemaname = 'public'
            and tablename in ('routine', 'routine_occurrence', 'routine_change')
            and rowsecurity) as tables_with_rls,
        (select count(*) = 3 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in ('routine', 'routine_occurrence', 'routine_change')
            and c.relforcerowsecurity) as rls_forced,
        (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'routine_due_targets' and p.prosecdef) as due_scan_definer,
        (select has_table_privilege('aisar_app', 'public.routine', 'DELETE') = false
            and has_table_privilege('aisar_app', 'public.routine', 'INSERT')) as app_grants`;
    for (const key of ['tables_with_rls', 'rls_forced', 'due_scan_definer', 'app_grants']) {
      if (!row[key]) throw new Error(`routines migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '022_routines', verified })}\n`);
} finally {
  await sql.end();
}
