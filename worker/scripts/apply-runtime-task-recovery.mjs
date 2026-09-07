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
  new URL('../migrations/019_runtime_task_recovery.sql', import.meta.url),
  'utf8',
);
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        to_regclass('public.runtime_task_outbox') is not null as outbox_table,
        exists (
          select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'runtime_task'
             and column_name = 'dispatch_phase'
        ) as dispatch_phase_col,
        (select count(*) from pg_proc
          where proname = 'runtime_recovery_targets' and prosecdef)::int > 0 as recovery_fn,
        (select count(*) > 0 from information_schema.routine_privileges
          where routine_name = 'runtime_recovery_targets'
            and grantee = 'aisar_app' and privilege_type = 'EXECUTE') as recovery_app_exec,
        (select count(*) from pg_proc
          where proname = 'runtime_outbox_batch' and prosecdef)::int > 0 as outbox_fn,
        (select count(*) > 0 from information_schema.routine_privileges
          where routine_name = 'runtime_outbox_batch'
            and grantee = 'aisar_app' and privilege_type = 'EXECUTE') as outbox_app_exec,
        (select count(*) from pg_proc
          where proname = 'runtime_drift_targets' and prosecdef
            and pronargs = 4)::int > 0 as drift_fn_4arg,
        (select count(*) > 0 from information_schema.routine_privileges
          where routine_name = 'runtime_drift_targets'
            and grantee = 'aisar_app' and privilege_type = 'EXECUTE') as drift_app_exec,
        exists (
          select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'runtime_usage'
             and column_name = 'finalization_state'
        ) as finalization_col`;
    const keys = ['outbox_table', 'dispatch_phase_col', 'recovery_fn', 'recovery_app_exec',
                  'outbox_fn', 'outbox_app_exec', 'drift_fn_4arg', 'drift_app_exec',
                  'finalization_col'];
    for (const key of keys) {
      if (!row[key]) throw new Error(`runtime_task_recovery migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '019_runtime_task_recovery', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
