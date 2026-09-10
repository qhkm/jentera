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
  new URL('../migrations/023_runtime_budget_token_caps.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select is_nullable = 'YES' and column_default is null from information_schema.columns
          where table_schema = 'public' and table_name = 'runtime_budget'
            and column_name = 'monthly_input_tokens') as input_optional,
        (select is_nullable = 'YES' and column_default is null from information_schema.columns
          where table_schema = 'public' and table_name = 'runtime_budget'
            and column_name = 'monthly_output_tokens') as output_optional,
        (select count(*) = 0 from public.runtime_budget
          where monthly_input_tokens is not null or monthly_output_tokens is not null) as rows_uncapped,
        (select count(*) from public.runtime_budget) as budget_rows`;
    for (const key of ['input_optional', 'output_optional', 'rows_uncapped']) {
      if (!row[key]) throw new Error(`runtime_budget token caps migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '023_runtime_budget_token_caps', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
