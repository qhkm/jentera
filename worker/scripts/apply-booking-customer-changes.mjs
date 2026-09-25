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

const migration = await readFile(new URL('../migrations/072_booking_customer_changes.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const columns = await tx`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'booking'
         and column_name in ('customer_cancelled_at', 'rescheduled_from_id', 'rescheduled_to_id')
       order by column_name`;
    const [table] = await tx`
      select relrowsecurity, relforcerowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'booking_customer_session'`;
    const [policy] = await tx`
      select 1 from pg_policies where schemaname = 'public'
       and tablename = 'booking_customer_session' and policyname = 'booking_customer_session_tenant'`;
    const [grants] = await tx`
      select array_agg(privilege_type order by privilege_type)::text as privileges
       from information_schema.role_table_grants where table_schema = 'public'
       and table_name = 'booking_customer_session' and grantee = 'aisar_app'`;
    if (columns.length !== 3 || !table?.relrowsecurity || !table?.relforcerowsecurity || !policy ||
        grants?.privileges !== '{DELETE,INSERT,SELECT,UPDATE}') {
      throw new Error(`booking customer changes verification failed: ${JSON.stringify({ columns, table, policy, grants })}`);
    }
  });
  console.log('ok    booking customer changes applied and verified');
} finally {
  await sql.end();
}
