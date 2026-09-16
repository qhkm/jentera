#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

// Operator-only additive migration. Secrets arrive through the environment,
// never command arguments, output, source or a browser endpoint.
const connection = process.env.AISAR_NEON_OWNER_URL;
if (!connection) throw new Error('AISAR_NEON_OWNER_URL is required');
const target = new URL(connection);
const hosts = new Set(['ep-sparkling-violet-b3l9d7un-pooler.c-4.ap-southeast-1.aws.neon.tech',
  'ep-sparkling-violet-b3l9d7un.c-4.ap-southeast-1.aws.neon.tech']);
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !hosts.has(target.hostname)
  || target.pathname !== '/neondb' || target.username !== 'neondb_owner' || !target.password) {
  throw new Error('Database does not match the reviewed production owner target');
}
const names = ['053_stripe_billing.sql', '054_billing_payment_evidence.sql',
  '055_launch_purchase_eligibility.sql', '056_billing_lifecycle.sql'];
const bodies = await Promise.all(names.map(name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));
const sql = postgres(connection, { max: 1, fetch_types: false, ssl: 'require' });
try {
  await sql.begin(async tx => {
    for (const body of bodies) await tx.unsafe(body);
    const [verified] = await tx`select
      (select count(*)=5 from pg_class where relnamespace='public'::regnamespace and relname in
        ('billing_checkout', 'billing_payment', 'billing_appreciation_outbox', 'billing_payment_adjustment', 'stripe_event')
        and relrowsecurity and relforcerowsecurity) as forced_rls,
      not has_table_privilege('aisar_app', 'public.billing_payment', 'update')
        and not has_table_privilege('aisar_app', 'public.billing_payment', 'delete')
        and not has_table_privilege('aisar_app', 'public.stripe_event', 'delete') as durable_evidence,
      has_function_privilege('aisar_app', 'public.billing_payer_has_payment(uuid)', 'execute')
        and has_function_privilege('aisar_app', 'public.billing_business_for_checkout(text)', 'execute')
        and has_function_privilege('aisar_app', 'public.billing_business_for_payment_intent(text)', 'execute') as resolvers,
      (select count(*)=6 from information_schema.columns where table_schema='public' and table_name='business'
        and column_name in ('stripe_customer_id', 'stripe_subscription_id', 'stripe_subscription_status',
          'stripe_current_period_end', 'stripe_paid_through', 'stripe_billing_review')) as columns`;
    if (Object.values(verified).some(value => value !== true)) throw new Error('Billing migration safety verification failed');
  });
  console.log(JSON.stringify({ ok: true, migrations: names, billingEnabled: false }));
} finally { await sql.end({ timeout: 5 }); }
