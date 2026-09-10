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
  new URL('../migrations/026_model_call.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'model_call') as table_present,
        (select relrowsecurity from pg_class
          where oid = 'public.model_call'::regclass) as rls_enabled,
        (select count(*) = 3 from pg_policies
          where schemaname = 'public' and tablename = 'model_call') as policies_present,
        (select count(*) = 0 from information_schema.columns
          where table_schema = 'public' and table_name = 'model_call'
            and column_name in ('business_id', 'runtime_task_id')) as no_tenant_columns,
        (select has_table_privilege('aisar_app', 'public.model_call', 'insert')) as app_can_insert,
        (select has_table_privilege('aisar_app', 'public.model_call', 'delete')) as app_can_sweep,
        (select not has_table_privilege('aisar_app', 'public.model_call', 'update')) as app_cannot_update,
        (select count(*) from public.model_call) as rows_present`;
    for (const key of ['table_present', 'rls_enabled', 'policies_present', 'no_tenant_columns',
                       'app_can_insert', 'app_can_sweep', 'app_cannot_update']) {
      if (!row[key]) throw new Error(`model_call migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '026_model_call', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
