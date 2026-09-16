import type { Env } from '../env';
import { stripeCheckoutEnabled, stripeClient, stripeLiveEnabled, stripeLiveDatabaseTransport, stripeWebhookEnabled, verifyStripeAccount, verifyStripeDatabase } from '../stripe';
import { verifiedLaunchCatalog } from './launch-catalog';

const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid',
  'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'];
export const REVIEWED_LIVE_WEBHOOK = 'we_1UGLbFHuvvz49fq3KyDg81LF';

/** Operator setup only. Never opens checkout or changes endpoint URL/events,
 * signing keys, account, catalog or customer state. The handler must already be
 * deployed and active while new purchases are explicitly closed. */
export async function enableReviewedStripeWebhook(env: Env) {
  if (!stripeLiveEnabled(env) || !stripeWebhookEnabled(env) || env.STRIPE_CHECKOUT_ENABLED !== 'false') {
    return { ok: false, err: 'Live fulfillment must be enabled with new purchases closed.', status: 409 };
  }
  const readiness = await checkStripeReadiness(env);
  if (readiness.failures.length || Object.entries(readiness.checks).some(([key, passed]) => key !== 'webhookEnabled' && !passed)) {
    return { ok: false, err: 'Billing readiness checks must pass before enabling delivery.', status: 409 };
  }
  const client = stripeClient(env);
  await verifyStripeAccount(env, client);
  const endpoint = await client.webhookEndpoints.retrieve(REVIEWED_LIVE_WEBHOOK);
  const matches = (value: typeof endpoint) => value.id === REVIEWED_LIVE_WEBHOOK && value.livemode
    && value.url === 'https://api.jentera.ai/api/webhooks/stripe' && value.api_version === '2026-08-26.dahlia'
    && !value.application && value.metadata?.jentera_billing === 'jentera-launch-billing-v1'
    && JSON.stringify([...value.enabled_events].sort()) === JSON.stringify([...EVENTS].sort());
  if (!matches(endpoint)) return { ok: false, err: 'The reviewed endpoint configuration does not match.', status: 409 };
  const enabled = endpoint.status === 'enabled' ? endpoint : await client.webhookEndpoints.update(REVIEWED_LIVE_WEBHOOK,
    { disabled: false }, { idempotencyKey: 'jentera-enable-reviewed-webhook-v1' });
  if (!matches(enabled) || enabled.status !== 'enabled') throw new Error('Webhook enablement could not be verified');
  return { ok: true, status: 200, webhookEnabled: true, checkoutEnabled: false };
}

/** Operator-authenticated, read-only verification of vault credentials. This
 * candidate enables SDK construction, not the deployed checkout/fulfillment
 * gates. Never returns keys, provider payloads or customer data. */
export async function checkStripeReadiness(env: Env) {
  const candidate = { ...env, STRIPE_BILLING_LIVE_ENABLED: 'true', STRIPE_CHECKOUT_ENABLED: 'false' };
  const credentialType = /^rk_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? '') ? 'restricted_live'
    : /^sk_live_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'unrestricted_live'
    : /^[sr]k_test_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'test'
    : env.STRIPE_SECRET_KEY ? 'invalid' : 'missing';
  const databaseChecks = { parseable: false, postgresProtocol: false, expectedPath: false, notLoopback: false,
    expectedBindingDatabase: env.HYPERDRIVE.database === 'neondb' };
  try {
    const database = new URL(env.HYPERDRIVE.connectionString);
    databaseChecks.parseable = true;
    databaseChecks.postgresProtocol = ['postgres:', 'postgresql:'].includes(database.protocol);
    databaseChecks.expectedPath = database.pathname === '/neondb';
    databaseChecks.notLoopback = !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname);
  } catch { /* Boolean only; never return a credential-bearing URI. */ }
  const configurationChecks = { credentialType, productionDatabase: stripeLiveDatabaseTransport(env), databaseChecks,
    sandboxOff: env.STRIPE_BILLING_SANDBOX_ENABLED !== 'true',
    approvedOrigins: env.APP_ORIGIN === 'https://jentera.ai' && env.API_ORIGIN === 'https://api.jentera.ai',
    approvedAccount: env.STRIPE_EXPECTED_ACCOUNT_ID === 'acct_1UG90wHuvvz49fq3',
    approvedCatalog: env.STRIPE_LAUNCH_PRODUCT === 'prod_VGrzwJYyjyq39c'
      && env.STRIPE_LAUNCH_MONTHLY_PRICE === 'price_1UGKFDHuvvz49fq3tGmnpgky'
      && env.STRIPE_LAUNCH_COUPON === 'jentera_launch_myr_100_off_3_months_v1' };
  const checks: Record<string, boolean> = {
    configuration: stripeLiveEnabled(candidate), databaseIdentity: false, signingSecret: /^whsec_\S+$/.test(env.STRIPE_WEBHOOK_SECRET ?? ''),
    account: false, catalog: false, webhookConfiguration: false, webhookEnabled: false,
    portalCancellation: false, portalPaymentMethods: false, portalInvoices: false, paymentEvidenceRead: false,
  };
  const failures: string[] = [];
  if (!checks.configuration) return { ok: true, checkoutEnabled: stripeCheckoutEnabled(env), ready: false, configurationChecks, checks, failures: ['configuration'] };
  const client = stripeClient(candidate);
  try { await verifyStripeDatabase(candidate); checks.databaseIdentity = true; }
  catch { failures.push('database_identity'); }
  if (!checks.databaseIdentity) return { ok: true, checkoutEnabled: stripeCheckoutEnabled(env), ready: false, configurationChecks, checks, failures };
  try { await verifyStripeAccount(candidate, client); checks.account = true; }
  catch { failures.push('account'); }
  // Do not inspect a seller's remaining resources until its identity matches.
  if (checks.account) {
    await Promise.all([
      (async () => {
        try { await verifiedLaunchCatalog(candidate, client, true); checks.catalog = true; }
        catch { failures.push('catalog'); }
      })(),
      (async () => {
        try {
          const endpoints = await client.webhookEndpoints.list({ limit: 100 });
          const matches = endpoints.data.filter(endpoint => endpoint.url === 'https://api.jentera.ai/api/webhooks/stripe');
          const endpoint = matches[0];
          checks.webhookConfiguration = !endpoints.has_more && matches.length === 1 && endpoint.livemode
            && endpoint.api_version === '2026-08-26.dahlia' && !endpoint.application
            && endpoint.metadata?.jentera_billing === 'jentera-launch-billing-v1'
            && JSON.stringify([...endpoint.enabled_events].sort()) === JSON.stringify([...EVENTS].sort());
          checks.webhookEnabled = checks.webhookConfiguration && endpoint.status === 'enabled';
        } catch { failures.push('webhook'); }
      })(),
      (async () => {
        try {
          const configurations = await client.billingPortal.configurations.list({ is_default: true, active: true, limit: 2 });
          const portal = configurations.data[0];
          if (configurations.has_more || configurations.data.length !== 1 || !portal.livemode || !portal.is_default) return;
          checks.portalCancellation = portal.features.subscription_cancel.enabled
            && portal.features.subscription_cancel.mode === 'at_period_end'
            && portal.features.subscription_cancel.proration_behavior === 'none';
          checks.portalPaymentMethods = portal.features.payment_method_update.enabled;
          checks.portalInvoices = portal.features.invoice_history.enabled;
        } catch { failures.push('portal'); }
      })(),
      (async () => {
        try {
          // Listing access is necessary for the evidence graph; payloads are
          // deliberately discarded, not returned or logged.
          await Promise.all([client.invoices.list({ limit: 1 }), client.invoicePayments.list({ limit: 1 }),
            client.paymentIntents.list({ limit: 1 }), client.charges.list({ limit: 1 }), client.subscriptions.list({ limit: 1 }),
            client.checkout.sessions.list({ limit: 1 }), client.disputes.list({ limit: 1 })]);
          checks.paymentEvidenceRead = true;
        } catch { failures.push('payment_evidence'); }
      })(),
    ]);
  }
  return { ok: true, checkoutEnabled: stripeCheckoutEnabled(env), ready: Object.values(checks).every(Boolean), configurationChecks, checks, failures: failures.sort() };
}
