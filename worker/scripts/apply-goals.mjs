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

const migration = await readFile(new URL('../migrations/048_goals.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'goal') as table_present,
        (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.goal'::regclass) as forced_rls,
        (select count(*) = 1 from pg_policies
          where schemaname = 'public' and tablename = 'goal'
            and policyname = 'goal_tenant') as tenant_policy,
        has_table_privilege('aisar_app', 'public.goal', 'select,insert,update') as app_grants,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'run' and column_name = 'goal_id') as run_column,
        (select count(*) = 1 from pg_constraint
          where conrelid = 'public.run'::regclass and conname = 'run_goal_fk') as run_fk`;
    for (const key of ['table_present', 'forced_rls', 'tenant_policy', 'app_grants', 'run_column', 'run_fk']) {
      if (!row[key]) throw new Error(`goals migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '048_goals', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
