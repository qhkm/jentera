#!/usr/bin/env node
/* Applies 064_runtime_task_answer_streamed.sql: the three columns that hold where a sprite
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
  new URL('../migrations/064_runtime_task_answer_streamed.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [column] = await tx`
      select data_type, column_default, is_nullable from information_schema.columns
       where table_name = 'runtime_task' and column_name = 'answer_streamed'`;
    if (!column || column.data_type !== 'boolean') throw new Error('answer_streamed column missing');
    const [grant] = await tx`
      select has_column_privilege('aisar_app', 'runtime_task', 'answer_streamed', 'update') as upd,
             has_column_privilege('aisar_app', 'runtime_task', 'answer_streamed', 'select') as sel`;
    if (!grant.upd || !grant.sel) throw new Error('aisar_app cannot read or write answer_streamed');
    return { column, grant };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '064_runtime_task_answer_streamed', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
