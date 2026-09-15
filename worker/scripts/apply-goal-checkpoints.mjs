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
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    !allowedHosts.has(target.hostname) || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(new URL('../migrations/049_goal_checkpoints.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        to_regclass('public.goal_checkpoint') is not null as table_present,
        (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.goal_checkpoint'::regclass) as forced_rls,
        (select count(*) = 1 from pg_policies
          where schemaname = 'public' and tablename = 'goal_checkpoint'
            and policyname = 'goal_checkpoint_tenant') as tenant_policy,
        has_table_privilege('aisar_app', 'public.goal_checkpoint', 'select,insert,update') as app_grants,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'run'
            and column_name = 'goal_checkpoint_id') as run_column,
        (select count(*) = 1 from pg_constraint
          where conrelid = 'public.run'::regclass
            and conname = 'run_goal_checkpoint_fk') as run_fk,
        (select count(*) = 1 from pg_constraint
          where conrelid = 'public.run'::regclass
            and conname = 'run_goal_checkpoint_required') as run_check`;
    for (const key of ['table_present', 'forced_rls', 'tenant_policy', 'app_grants', 'run_column', 'run_fk', 'run_check']) {
      if (!row[key]) throw new Error(`goal checkpoints migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '049_goal_checkpoints', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
