#!/usr/bin/env node
// Intentional production migration only; never runs during app builds.
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
const migration = await readFile(new URL('../migrations/065_bot_preferences.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async tx => {
    await tx.unsafe(migration);
    const [row] = await tx`select
      (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.bot_preference'::regclass) as forced_rls,
      (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'bot_preference' and policyname = 'bot_preference_tenant') as tenant_policy,
      has_table_privilege('aisar_app', 'public.bot_preference', 'select,insert,update,delete') as preferences_grant,
      has_column_privilege('aisar_app', 'public.specialist_profile', 'avatar', 'select,insert,update') as avatar_grant`;
    for (const key of ['forced_rls', 'tenant_policy', 'preferences_grant', 'avatar_grant']) {
      if (!row[key]) throw new Error(`Bot preferences migration verification failed: ${key}`);
    }
    return row;
  });
  console.log(JSON.stringify({ ok: true, migration: '065_bot_preferences', verified }));
} finally {
  await sql.end({ timeout: 5 });
}
