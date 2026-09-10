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
  new URL('../migrations/028_specialist_profile.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'specialist_profile') as table_present,
        (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.specialist_profile'::regclass) as forced_rls,
        (select count(*) = 1 from pg_policies
          where schemaname = 'public' and tablename = 'specialist_profile'
            and policyname = 'specialist_profile_tenant') as tenant_policy,
        (select has_table_privilege('aisar_app', 'public.specialist_profile',
          'select,insert,update,delete')) as app_can_use,
        (select not exists (
          select 1 from public.business b
           where not exists (
             select 1 from public.specialist_profile s where s.business_id = b.id
           )
        )) as existing_businesses_seeded`;
    for (const key of [
      'table_present', 'forced_rls', 'tenant_policy', 'app_can_use',
      'existing_businesses_seeded',
    ]) {
      if (!row[key]) throw new Error(`specialist migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '028_specialist_profile', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
