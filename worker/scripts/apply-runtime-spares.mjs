#!/usr/bin/env node
/** Apply 059 before releasing pool-aware code. Never creates compute. */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

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
const migration = await readFile(new URL('../migrations/059_runtime_spares.sql', import.meta.url), 'utf8');
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
  });
  console.log(JSON.stringify({ ok: true, migration: '059_runtime_spares', computeCreated: false }));
} catch {
  // Database/network exception objects can contain credentials. Never print
  // them from an operator command; the transaction either commits or rolls back.
  throw new Error('Runtime spare migration failed; connection details suppressed');
} finally { await sql.end(); }
