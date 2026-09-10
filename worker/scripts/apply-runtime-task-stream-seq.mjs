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
  new URL('../migrations/025_runtime_task_stream_seq.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) > 0 from information_schema.columns
          where table_schema = 'public' and table_name = 'runtime_task' and column_name = 'stream_seq') as stream_seq_column,
        (select count(*) from public.runtime_task where stream_seq <> 0) as resumed_rows`;
    if (!row.stream_seq_column) throw new Error('runtime_task stream_seq migration verification failed: stream_seq_column');
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '025_runtime_task_stream_seq', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}

