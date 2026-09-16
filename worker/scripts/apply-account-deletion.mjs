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

const migration = await readFile(new URL('../migrations/051_account_deletion.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        to_regclass('public.account_deletion') is not null as table_present,
        to_regclass('public.idx_account_deletion_due') is not null as index_present,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'business'
            and column_name = 'deleted_at') as business_column,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'app_user'
            and column_name = 'deleted_at') as user_column,
        has_table_privilege('aisar_app', 'public.account_deletion', 'select,insert,update,delete')
          as app_grants,
        to_regprocedure('public.account_deletion_due(timestamptz, integer)') is not null
          as due_function,
        to_regprocedure('public.invitations_for_email(text)') is not null
          as invitations_function,
        (select p.prosecdef from pg_proc p
          where p.oid = 'public.account_deletion_due(timestamptz, integer)'::regprocedure)
          as due_definer,
        (select p.prosecdef from pg_proc p
          where p.oid = 'public.invitations_for_email(text)'::regprocedure)
          as invitations_definer,
        has_function_privilege('aisar_app',
          'public.account_deletion_due(timestamptz, integer)', 'execute') as due_execute,
        has_function_privilege('aisar_app',
          'public.invitations_for_email(text)', 'execute') as invitations_execute,
        /* A null proacl means the default, which is EXECUTE to PUBLIC — so
           "no PUBLIC entry" is only meaningful once the revoke has written
           an ACL at all. Grantee 0 is PUBLIC. */
        (select p.proacl is not null
                and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
           from pg_proc p
          where p.oid = 'public.account_deletion_due(timestamptz, integer)'::regprocedure)
          as due_not_public,
        (select p.proacl is not null
                and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
           from pg_proc p
          where p.oid = 'public.invitations_for_email(text)'::regprocedure)
          as invitations_not_public`;
    for (const key of [
      'table_present', 'index_present', 'business_column', 'user_column', 'app_grants',
      'due_function', 'invitations_function', 'due_definer', 'invitations_definer',
      'due_execute', 'invitations_execute', 'due_not_public', 'invitations_not_public',
    ]) {
      if (!row[key]) throw new Error(`account deletion migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '051_account_deletion', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
