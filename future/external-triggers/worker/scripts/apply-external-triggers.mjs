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
if (!['postgresql:', 'postgres:'].includes(target.protocol) || !allowedHosts.has(target.hostname)
    || target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}
const migration = await readFile(new URL('../migrations/051_external_triggers.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async tx => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('external_trigger', 'external_trigger_event')
          and c.relrowsecurity and c.relforcerowsecurity) as forced_rls,
        has_function_privilege('aisar_app', 'public.external_trigger_target(uuid)', 'EXECUTE') as routing_allowed,
        not has_table_privilege('aisar_app', 'public.external_trigger_route', 'SELECT') as routing_private,
        not has_column_privilege('aisar_app', 'public.external_trigger', 'task', 'UPDATE') as task_immutable,
        not has_table_privilege('aisar_app', 'public.external_trigger_event', 'DELETE') as receipts_append_only,
        not has_function_privilege('aisar_app', 'public.external_trigger_sync_route()', 'EXECUTE') as no_direct_routing_writes,
        exists (select 1 from pg_constraint where conrelid = 'public.external_trigger_event'::regclass
          and confrelid = 'public.external_trigger'::regclass and contype = 'f' and array_length(conkey, 1) = 2) as tenant_bound_grant,
        exists (select 1 from pg_constraint where conrelid = 'public.external_trigger_event'::regclass
          and confrelid = 'public.run'::regclass and contype = 'f' and array_length(conkey, 1) = 2) as tenant_bound_run,
        not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
          where p.oid = 'public.external_trigger_target(uuid)'::regprocedure
          and a.grantee = 0 and a.privilege_type = 'EXECUTE') as no_public_routing`;
    if (Object.values(row).some(value => value !== true)) throw new Error('external trigger migration security verification failed');
  });
  process.stdout.write(JSON.stringify({ ok: true, migration: '051_external_triggers', securityVerified: true }) + '\n');
} finally {
  await sql.end({ timeout: 5 });
}
