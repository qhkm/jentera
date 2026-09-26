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

const migration = await readFile(new URL('../migrations/077_booking_page_welcome_copy.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const columns = await tx`
      select column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'booking_settings'
         and column_name in ('welcome_title', 'welcome_message') order by column_name`;
    if (columns.length !== 2 || columns.some((column) => column.data_type !== 'text' || column.is_nullable !== 'YES')) {
      throw new Error(`booking page welcome copy migration verification failed: ${JSON.stringify(columns)}`);
    }
  });
  console.log('ok    booking page welcome copy applied and verified');
} finally {
  await sql.end();
}
