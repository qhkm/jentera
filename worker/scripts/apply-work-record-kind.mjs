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
  new URL('../migrations/024_work_record_kind.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) > 0 from information_schema.columns
          where table_schema = 'public' and table_name = 'work_record' and column_name = 'kind') as kind_column,
        (select count(*) from public.work_record where kind = 'work') as work_rows,
        (select count(*) from public.work_record where kind = 'conversation') as conversation_rows`;
    if (!row.kind_column) throw new Error('work_record kind migration verification failed: kind_column');
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '024_work_record_kind', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}

