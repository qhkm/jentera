#!/usr/bin/env node
// Intentional production migration only; never runs during app builds.
//
// Adds the columns and the two SECURITY DEFINER functions the quarter-hour
// liveness probe needs. The Worker must not be deployed before this runs:
// sweepRuntimeLiveness calls runtime_liveness_targets every fifteen minutes,
// and a missing function would be a cron failing on a schedule.
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    target.hostname !== 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech' ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(
  new URL('../migrations/067_runtime_liveness.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async tx => {
    await tx.unsafe(migration);

    const columns = await tx`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'agent_runtime'
         and column_name in ('last_checked_at', 'last_check_outcome', 'unhealthy_since')
       order by column_name`;
    if (columns.length !== 3) {
      throw new Error(`expected three liveness columns, found ${columns.length}`);
    }

    /* The functions are the half that cannot be checked by reading a column:
       the cron has no tenant, so without them the sweep would select zero
       rows forever and look perfectly healthy doing it. */
    const [targets] = await tx`select count(*)::int as n from public.runtime_liveness_targets(500)`;
    const [fleet] = await tx`select count(*)::int as n from agent_runtime
      where deleted_at is null and provider_url is not null`;
    if (targets.n !== fleet.n) {
      throw new Error(`runtime_liveness_targets returned ${targets.n} of ${fleet.n} live runtimes`);
    }

    /* Grants matter as much as existence: aisar_app is what the Worker
       connects as, and a function it cannot execute fails at 2am, not now. */
    const grants = await tx`
      select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('runtime_liveness_targets', 'record_runtime_liveness')
         and has_function_privilege('aisar_app', p.oid, 'execute')
       order by p.proname`;
    if (grants.length !== 2) {
      throw new Error(`aisar_app can execute ${grants.length} of 2 liveness functions`);
    }

    /* Nothing has been probed yet, so every row must still read null. A
       migration that invented an outcome would start the fleet in a state
       nobody measured. */
    const [written] = await tx`select count(*)::int as n from agent_runtime
      where last_check_outcome is not null or unhealthy_since is not null`;
    if (written.n !== 0) {
      throw new Error(`migration wrote ${written.n} liveness outcomes; it must write none`);
    }

    return { liveRuntimes: fleet.n, functions: grants.map(row => row.proname) };
  });
  console.log(JSON.stringify({ ok: true, migration: '067_runtime_liveness', verified }));
} finally {
  await sql.end({ timeout: 5 });
}
