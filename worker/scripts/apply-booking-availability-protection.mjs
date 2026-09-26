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

const migration = await readFile(new URL('../migrations/074_booking_availability_protection.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const tables = await tx`
      select relname, relrowsecurity, relforcerowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and relname in
         ('booking_block', 'booking_calendar_availability', 'booking_calendar_busy')
       order by relname`;
    const policies = await tx`
      select tablename from pg_policies where schemaname = 'public'
       and policyname in ('booking_block_tenant', 'booking_calendar_availability_tenant', 'booking_calendar_busy_tenant')
       order by tablename`;
    const [routine] = await tx`
      select has_function_privilege('aisar_app', 'public.booking_calendar_availability_due(timestamptz, integer)', 'EXECUTE') as executable`;
    if (tables.length !== 3 || tables.some((table) => !table.relrowsecurity || !table.relforcerowsecurity) ||
        policies.length !== 3 || !routine?.executable) {
      throw new Error(`booking availability verification failed: ${JSON.stringify({ tables, policies, routine })}`);
    }
  });
  console.log('ok    booking availability protection applied and verified');
} finally {
  await sql.end();
}
