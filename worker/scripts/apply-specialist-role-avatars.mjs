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

const migration = await readFile(
  new URL('../migrations/066_specialist_role_avatars.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async tx => {
    await tx.unsafe(migration);
    const rows = await tx`
      select profile_key, avatar, count(*)::int as total
        from specialist_profile
       where profile_key in ('operations', 'customers', 'growth', 'records')
       group by profile_key, avatar
       order by profile_key, avatar`;
    const expected = new Map([
      ['operations', 'purple'],
      ['customers', 'pink'],
      ['growth', 'yellow'],
      ['records', 'orange'],
    ]);
    for (const [profile, avatar] of expected) {
      if (rows.some(row => row.profile_key === profile && row.avatar === 'original')) {
        throw new Error(`Starter avatar migration left ${profile} on original`);
      }
      if (!rows.some(row => row.profile_key === profile && row.avatar === avatar)) {
        throw new Error(`Starter avatar migration did not assign ${avatar} to ${profile}`);
      }
    }
    return rows;
  });
  console.log(JSON.stringify({ ok: true, migration: '066_specialist_role_avatars', verified }));
} finally {
  await sql.end({ timeout: 5 });
}
