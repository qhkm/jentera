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
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !allowedHosts.has(target.hostname) ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(new URL('../migrations/073_booking_reminders_cutoff.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [column] = await tx`
      select column_default, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'booking_settings'
         and column_name = 'change_cutoff_minutes'`;
    const [table] = await tx`
      select relrowsecurity, relforcerowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'booking_reminder'`;
    const [policy] = await tx`
      select 1 from pg_policies where schemaname = 'public'
       and tablename = 'booking_reminder' and policyname = 'booking_reminder_tenant'`;
    const [grants] = await tx`
      select array_agg(privilege_type order by privilege_type)::text as privileges
       from information_schema.role_table_grants where table_schema = 'public'
       and table_name = 'booking_reminder' and grantee = 'aisar_app'`;
    const [routine] = await tx`
      select has_function_privilege('aisar_app', 'public.booking_reminders_due(timestamptz, integer)', 'EXECUTE') as executable`;
    if (!column || column.is_nullable !== 'NO' || !table?.relrowsecurity || !table?.relforcerowsecurity || !policy ||
        grants?.privileges !== '{INSERT,SELECT,UPDATE}' || !routine?.executable) {
      throw new Error(`booking reminders verification failed: ${JSON.stringify({ column, table, policy, grants, routine })}`);
    }
  });
  console.log('ok    booking reminders and change cutoff applied and verified');
} finally {
  await sql.end();
}
