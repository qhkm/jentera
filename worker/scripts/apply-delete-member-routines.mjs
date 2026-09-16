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
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    !allowedHosts.has(target.hostname) || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(new URL('../migrations/052_delete_member_routines.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        to_regprocedure('public.delete_member_routines(uuid, uuid)') is not null as function_present,
        (select p.prosecdef from pg_proc p
          where p.oid = 'public.delete_member_routines(uuid, uuid)'::regprocedure) as definer,
        has_function_privilege('aisar_app',
          'public.delete_member_routines(uuid, uuid)', 'execute') as app_execute,
        /* Grantee 0 is PUBLIC; a null proacl is the default, which grants
           EXECUTE to PUBLIC, so the ACL must exist for the absence to mean
           anything. */
        (select p.proacl is not null
                and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
           from pg_proc p
          where p.oid = 'public.delete_member_routines(uuid, uuid)'::regprocedure) as not_public,
        /* 022 revoked DELETE on routine from the app role on purpose, and
           this function is the single exception to that. If the grant ever
           came back, the function would be pointless and the rule broken. */
        not has_table_privilege('aisar_app', 'public.routine', 'delete') as routine_delete_still_revoked`;
    for (const key of [
      'function_present', 'definer', 'app_execute', 'not_public',
      'routine_delete_still_revoked',
    ]) {
      if (!row[key]) throw new Error(`delete_member_routines migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '052_delete_member_routines', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
