#!/usr/bin/env node
/* Applies 063_runtime_egress.sql: the three columns that hold where a sprite
   was last seen calling us from. Verifies aisar_app can write them, because
   the route that records egress runs as aisar_app and a column the grant
   does not cover would fail only in production, hours later, as a warning. */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const expectedHost = 'ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech';
const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
if ((target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') ||
    target.hostname !== expectedHost || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(
  new URL('../migrations/063_runtime_egress.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const columns = await tx`
      select column_name, data_type from information_schema.columns
       where table_name = 'agent_runtime' and column_name like 'egress%'
       order by column_name`;
    const names = columns.map((c) => c.column_name);
    if (names.join(',') !== 'egress_colo,egress_country,egress_seen_at') {
      throw new Error(`runtime egress columns missing: ${names.join(',') || 'none'}`);
    }
    const [grant] = await tx`
      select has_column_privilege('aisar_app', 'agent_runtime', 'egress_colo', 'update') as colo,
             has_column_privilege('aisar_app', 'agent_runtime', 'egress_country', 'update') as country,
             has_column_privilege('aisar_app', 'agent_runtime', 'egress_seen_at', 'update') as seen_at`;
    if (!grant.colo || !grant.country || !grant.seen_at) {
      throw new Error('aisar_app cannot update the runtime egress columns');
    }
    return { columns: names, grant };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '063_runtime_egress', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
