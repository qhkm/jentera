#!/usr/bin/env node
/** Apply 059 or --recovery 060 before releasing matching code. No compute. */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const recovery = process.argv[2] === '--recovery';
if (process.argv.length > 3 || (process.argv[2] && !recovery)) throw new Error('Unsupported migration option');
const migrationName = recovery ? '060_runtime_spare_recovery' : '059_runtime_spares';

const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
let target;
try { target = new URL(connection); }
catch { throw new Error('AISAR_NEON_OWNER_URL must be a valid database URL'); }
const allowedHosts = new Set([
  'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech',
]);
if (!['postgresql:', 'postgres:'].includes(target.protocol) || !allowedHosts.has(target.hostname) ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password ||
    (target.port && target.port !== '5432') || target.hash) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}
const migration = await readFile(new URL(`../migrations/${migrationName}.sql`, import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async tx => {
    await tx.unsafe(migration);
    const [verified] = await tx`select
      has_table_privilege('aisar_app','public.runtime_spare','select') as direct_read,
      has_table_privilege('aisar_app','public.runtime_spare','update') as direct_write,
      has_function_privilege('aisar_app','public.claim_runtime_spare(text,text)','execute') as can_claim,
      has_function_privilege('aisar_app','public.queue_runtime_spares(text,text,integer)','execute') as can_queue`;
    if (verified.direct_read || verified.direct_write || !verified.can_claim || !verified.can_queue) {
      throw new Error('runtime spare permissions failed verification');
    }
    if (recovery) {
      const [permissions] = await tx`select
        has_table_privilege('aisar_app','public.runtime_spare_monitor','select') as direct_read,
        has_table_privilege('aisar_app','public.runtime_spare_monitor','update') as direct_write,
        has_function_privilege('aisar_app','public.lease_runtime_spare_retirement(uuid,uuid)','execute') as can_lease,
        has_function_privilege('aisar_app','public.finish_runtime_spare_retirement(uuid,uuid,boolean,boolean)','execute') as can_finish,
        has_function_privilege('aisar_app','public.lease_runtime_spare_alert(text,text,integer,uuid)','execute') as can_alert`;
      if (permissions.direct_read || permissions.direct_write || !permissions.can_lease || !permissions.can_finish || !permissions.can_alert) {
        throw new Error('runtime spare recovery permissions failed verification');
      }
    }
  });
  console.log(JSON.stringify({ ok: true, migration: migrationName, computeCreated: false }));
} catch {
  // Database/network exception objects can contain credentials. Never print
  // them from an operator command; the transaction either commits or rolls back.
  throw new Error('Runtime spare migration failed; connection details suppressed');
} finally { await sql.end(); }
