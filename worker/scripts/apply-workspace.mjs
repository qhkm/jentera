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
  new URL('../migrations/036_workspace.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 2 from information_schema.tables
          where table_schema = 'public' and table_name in ('workspace', 'workspace_member')) as tables_present,
        (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
          where oid in ('public.workspace'::regclass, 'public.workspace_member'::regclass)) as forced_rls,
        (select count(*) = 2 from pg_policies
          where schemaname = 'public' and policyname in ('workspace_tenant', 'workspace_member_tenant')) as tenant_policies,
        (select has_table_privilege('aisar_app', 'public.workspace', 'select,insert,update,delete')
          and has_table_privilege('aisar_app', 'public.workspace_member', 'select,insert,update,delete')) as app_grants,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'chat_session' and column_name = 'workspace_id') as chat_column,
        (select count(*) = 1 from pg_constraint
          where conrelid = 'public.chat_session'::regclass and conname = 'chat_session_workspace_fk') as chat_fk`;
    for (const key of ['tables_present', 'forced_rls', 'tenant_policies', 'app_grants', 'chat_column', 'chat_fk']) {
      if (!row[key]) throw new Error(`workspace migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '036_workspace', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
