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
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !allowedHosts.has(target.hostname) ||
    target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(new URL('../migrations/070_booking_details.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const rows = await tx`
      select table_name, column_name, data_type from information_schema.columns
       where table_schema = 'public' and
         (table_name, column_name) in (('booking_settings', 'location'), ('booking_service', 'description'))
       order by table_name, column_name`;
    if (rows.length !== 2 || rows.some((row) => row.data_type !== 'text')) {
      throw new Error(`booking details migration verification failed: ${JSON.stringify(rows)}`);
    }
  });
  console.log('ok    booking detail columns applied and verified');
} finally {
  await sql.end();
}
