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
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    !allowedHosts.has(target.hostname) || target.pathname !== '/neondb' ||
    target.username !== 'neondb_owner' || !target.password) {
  throw new Error('AISAR_NEON_OWNER_URL does not match the reviewed production owner target');
}

const migration = await readFile(new URL('../migrations/051_stripe_billing.sql', import.meta.url), 'utf8');
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  const verified = await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    const [row] = await tx`
      select
        (select count(*) = 4 from information_schema.columns
          where table_schema = 'public' and table_name = 'business'
            and column_name in ('stripe_customer_id', 'stripe_subscription_id',
                                'stripe_subscription_status', 'stripe_current_period_end')) as business_columns,
        (select count(*) = 1 from pg_indexes
          where schemaname = 'public' and tablename = 'business'
            and indexname = 'idx_business_stripe_customer') as customer_index,
        to_regclass('public.stripe_event') is not null as event_table,
        has_table_privilege('aisar_app', 'public.stripe_event', 'select,insert,delete') as event_grants,
        to_regprocedure('public.business_id_for_stripe_customer(text)') is not null as resolver_fn,
        has_function_privilege('aisar_app', 'public.business_id_for_stripe_customer(text)', 'execute') as resolver_grant`;
    for (const key of ['business_columns', 'customer_index', 'event_table', 'event_grants', 'resolver_fn', 'resolver_grant']) {
      if (!row[key]) throw new Error(`stripe billing migration verification failed: ${key}`);
    }
    return row;
  });
  process.stdout.write(`${JSON.stringify({ ok: true, migration: '051_stripe_billing', verified })}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
