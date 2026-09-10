#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const expectedHost = 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech';
const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
  throw new Error('AISAR_NEON_OWNER_URL must be PostgreSQL');
}
if (target.hostname !== expectedHost || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(
  new URL('../migrations/027_runtime_identity.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'runtime_business_for_rider') as function_present,
        (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'runtime_business_for_rider') as security_definer,
        (select provolatile = 's' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'runtime_business_for_rider') as stable,
        (select has_function_privilege('aisar_app',
          'public.runtime_business_for_rider(text)', 'execute')) as app_can_execute,
        (select not has_function_privilege('public',
          'public.runtime_business_for_rider(text)', 'execute')) as public_cannot_execute,
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'agent_runtime'
            and column_name = 'observed_config_version') as column_present,
        /* The function must answer for a real rider and stay silent for a
           made-up one — proof it resolves rather than merely existing. */
        (select public.runtime_business_for_rider(
           (select provider_name from public.agent_runtime
             where provider = 'fly-sprite' and deleted_at is null limit 1)) is not null
        ) as resolves_a_real_rider,
        (select public.runtime_business_for_rider('aisar-b-notarealrider0000') is null
        ) as unknown_rider_is_null`;
    for (const key of ['function_present', 'security_definer', 'stable', 'app_can_execute',
                       'public_cannot_execute', 'column_present', 'resolves_a_real_rider',
                       'unknown_rider_is_null']) {
      if (!row[key]) throw new Error(`runtime identity migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '027_runtime_identity', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
