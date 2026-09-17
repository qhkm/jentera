#!/usr/bin/env node
/** Release gate: current-pin ready inventory, read-only and no provider wake. */
import postgres from 'postgres';

const [release, bundle, desired] = process.argv.slice(2);
if (process.argv.length !== 5 || !/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$/.test(release ?? '') ||
    !/^[0-9a-f]{40}$/.test(bundle ?? '') || !/^[12]$/.test(desired ?? '')) {
  console.error('Usage: watch-spare-pool.mjs RELEASE BUNDLE TARGET_1_OR_2'); process.exit(2);
}
const connection = process.env.AISAR_NEON_OWNER_URL;
let target;
try { target = new URL(connection ?? ''); } catch { /* Refuse before connecting. */ }
if (!target || !['postgresql:', 'postgres:'].includes(target.protocol) ||
    !['ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
      'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech'].includes(target.hostname) ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password ||
    (target.port && target.port !== '5432') || target.hash) {
  console.error('Explicit reviewed production owner target required; credentials suppressed'); process.exit(2);
}
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
let passed = false;
try {
  for (let tick = 1; tick <= 45; tick++) {
    const [health] = await sql.begin(async tx => {
      await tx`set transaction read only`;
      return tx`select * from public.runtime_spare_health(${release},${bundle})`;
    });
    console.log(JSON.stringify({ stage: 'spare-pool', tick, release, target: Number(desired), ...health }));
    if (health.ready >= Number(desired)) { passed = true; break; }
    if (health.review_required > 0) { console.error('Spare pool requires manual review; unsafe inventory retained'); break; }
    if (tick < 45) await new Promise(resolve => setTimeout(resolve, 20_000));
  }
  if (!passed) { console.error('Spare replenishment gate failed; cold provisioning remains available'); process.exitCode = 1; }
} catch { console.error('Spare inventory check failed; connection details suppressed'); process.exitCode = 1; }
finally { await sql.end({ timeout: 5 }); }
