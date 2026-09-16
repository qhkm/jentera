#!/usr/bin/env node
/** Operator-only. Applies 052_waitlist_notice.sql to production and verifies
    the grants the announcement route depends on. */
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
const migration = await readFile(new URL('../migrations/052_waitlist_notice.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async tx => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        has_table_privilege('aisar_app', 'public.waitlist_notice', 'select,insert') as route_can_record,
        not has_table_privilege('aisar_app', 'public.waitlist_notice', 'delete,update') as record_is_append_only,
        (select count(*) = 1 from pg_constraint
          where conrelid = 'public.waitlist_notice'::regclass and contype = 'f') as tied_to_waitlist`;
    if (!row.route_can_record || !row.record_is_append_only || !row.tied_to_waitlist) {
      throw new Error(`Waitlist notice verification failed: ${JSON.stringify(row)}`);
    }
  });
  const [state] = await sql`
    select (select count(*)::int from waitlist_entry) as waitlist,
           (select count(*)::int from waitlist_notice) as already_notified`;
  console.log(`Applied. Waitlist ${state.waitlist}; announcements already recorded: ${state.already_notified}.`);
} finally { await sql.end({ timeout: 5 }); }
