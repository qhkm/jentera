import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnv, req } from './harness';
import { handleSupport } from '../src/routes/support';
import { LIVE_LAUNCH_CATALOG, LIVE_STRIPE_ACCOUNT } from '../src/stripe';
import { REVIEWED_LIVE_WEBHOOK } from '../src/billing/readiness';

const { sdk } = vi.hoisted(() => ({ sdk: {
  databaseIdentity: vi.fn(),
  accounts: { retrieve: vi.fn() }, prices: { retrieve: vi.fn() }, coupons: { retrieve: vi.fn() },
  webhookEndpoints: { list: vi.fn(), retrieve: vi.fn(), update: vi.fn() }, billingPortal: { configurations: { list: vi.fn() } },
  invoices: { list: vi.fn() }, invoicePayments: { list: vi.fn() }, paymentIntents: { list: vi.fn() },
  charges: { list: vi.fn() }, subscriptions: { list: vi.fn() }, checkout: { sessions: { list: vi.fn() } }, disputes: { list: vi.fn() },
} }));
vi.mock('../src/stripe', async importActual => ({ ...await importActual<typeof import('../src/stripe')>(), stripeClient: () => sdk }));
vi.mock('../src/db', async importActual => ({ ...await importActual<typeof import('../src/db')>(),
  withUser: (_env: unknown, query: (sql: typeof sdk.databaseIdentity) => unknown) => query(sdk.databaseIdentity) }));

const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid',
  'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'];
const env = () => testEnv({ AISAR_SUPPORT_KEY: 'support-fixture', STRIPE_SECRET_KEY: ['rk', 'live', 'fixture'].join('_'),
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_BILLING_LIVE_ENABLED: 'false', STRIPE_CHECKOUT_ENABLED: 'false',
  STRIPE_EXPECTED_ACCOUNT_ID: LIVE_STRIPE_ACCOUNT, STRIPE_LAUNCH_PRODUCT: LIVE_LAUNCH_CATALOG.product,
  STRIPE_LAUNCH_MONTHLY_PRICE: LIVE_LAUNCH_CATALOG.price, STRIPE_LAUNCH_COUPON: LIVE_LAUNCH_CATALOG.coupon,
  APP_ORIGIN: 'https://jentera.ai', API_ORIGIN: 'https://api.jentera.ai',
  HYPERDRIVE: { connectionString: 'postgres://fixture:fixture@reviewed.example/neondb' } });
async function call(key = 'support-fixture', method = 'GET', configuration = env()) {
  const { request, url } = req(method, '/api/support/billing-readiness');
  if (key) request.headers.set('Authorization', `Bearer ${key}`);
  return (await handleSupport(request, configuration, url, {}))!;
}
beforeEach(() => {
  vi.resetAllMocks();
  sdk.databaseIdentity.mockResolvedValue([{ database_name: 'neondb', role_name: 'aisar_app' }]);
  sdk.accounts.retrieve.mockResolvedValue({ id: LIVE_STRIPE_ACCOUNT, country: 'MY', charges_enabled: true });
  sdk.prices.retrieve.mockResolvedValue({ id: LIVE_LAUNCH_CATALOG.price, active: true, livemode: true, currency: 'myr',
    unit_amount: 19900, billing_scheme: 'per_unit', type: 'recurring', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    product: { id: LIVE_LAUNCH_CATALOG.product, active: true, livemode: true } });
  sdk.coupons.retrieve.mockResolvedValue({ id: LIVE_LAUNCH_CATALOG.coupon, valid: true, livemode: true, currency: 'myr', amount_off: 10000,
    percent_off: null, duration: 'repeating', duration_in_months: 3, applies_to: { products: [LIVE_LAUNCH_CATALOG.product] } });
  sdk.webhookEndpoints.list.mockResolvedValue({ has_more: false, data: [{ url: 'https://api.jentera.ai/api/webhooks/stripe',
    livemode: true, api_version: '2026-08-26.dahlia', metadata: { jentera_billing: 'jentera-launch-billing-v1' }, enabled_events: events, status: 'enabled' }] });
  sdk.billingPortal.configurations.list.mockResolvedValue({ has_more: false, data: [{ is_default: true, livemode: true, features: {
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    payment_method_update: { enabled: true }, invoice_history: { enabled: true },
  } }] });
});
describe('narrow operator webhook enablement', () => {
  const configuration = () => ({ ...env(), STRIPE_BILLING_LIVE_ENABLED: 'true' });
  async function enable(overrides = {}, key = 'support-fixture', method = 'POST', body: unknown = { confirm: 'enable-reviewed-billing-webhook' }) {
    const { request, url } = req(method, '/api/support/billing-webhook-enable', { body });
    request.headers.set('Authorization', `Bearer ${key}`);
    return (await handleSupport(request, { ...configuration(), ...overrides }, url, {}))!;
  }
  async function endpoint() {
    return { ...(await sdk.webhookEndpoints.list()).data[0], id: REVIEWED_LIVE_WEBHOOK };
  }
  it('enables only the exact reviewed endpoint and keeps purchases closed', async () => {
    const reviewed = await endpoint();
    sdk.webhookEndpoints.retrieve.mockResolvedValue({ ...reviewed, status: 'disabled' });
    sdk.webhookEndpoints.update.mockResolvedValue({ ...reviewed, status: 'enabled' });
    const response = await enable();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ ok: true, webhookEnabled: true, checkoutEnabled: false });
    expect(sdk.webhookEndpoints.update).toHaveBeenCalledWith(REVIEWED_LIVE_WEBHOOK, { disabled: false },
      { idempotencyKey: 'jentera-enable-reviewed-webhook-v1' });
  });
  it('does not mutate an already enabled reviewed endpoint', async () => {
    sdk.webhookEndpoints.retrieve.mockResolvedValue(await endpoint());
    expect((await enable()).status).toBe(200); expect(sdk.webhookEndpoints.update).not.toHaveBeenCalled();
  });
  it.each([{ STRIPE_BILLING_LIVE_ENABLED: 'false' }, { STRIPE_CHECKOUT_ENABLED: 'true' }, { STRIPE_WEBHOOK_SECRET: '' }])(
    'refuses unsafe deployment gates: %j', async gates => {
      expect((await enable(gates)).status).toBe(409); expect(sdk.webhookEndpoints.update).not.toHaveBeenCalled();
    });
  it('requires dedicated support authentication, not the management-key fallback', async () => {
    expect((await enable({ AISAR_SUPPORT_KEY: '', AISAR_OPENROUTER_MANAGEMENT_KEY: 'management' }, 'management')).status).toBe(401);
    expect(sdk.accounts.retrieve).not.toHaveBeenCalled();
  });
  it('refuses an unauthorized caller before reading provider data', async () => {
    expect((await enable({}, 'wrong')).status).toBe(401); expect(sdk.accounts.retrieve).not.toHaveBeenCalled();
  });
  it('requires an explicit action and rejects arbitrary endpoint/resource input', async () => {
    expect((await enable({}, 'support-fixture', 'POST', { confirm: 'enable-reviewed-billing-webhook', url: 'https://attacker.invalid' })).status).toBe(400);
    expect((await enable({}, 'support-fixture', 'GET')).status).toBe(405);
    expect(sdk.accounts.retrieve).not.toHaveBeenCalled();
  });
  it('refuses delivery when portal/readiness is incomplete', async () => {
    sdk.billingPortal.configurations.list.mockResolvedValue({ has_more: false, data: [] });
    expect((await enable()).status).toBe(409); expect(sdk.webhookEndpoints.update).not.toHaveBeenCalled();
  });
  it.each([{ url: 'https://attacker.invalid' }, { api_version: 'older' }, { livemode: false }, { enabled_events: ['*'] }, { id: 'we_other' }])(
    'rejects a changed reviewed endpoint: %j', async mismatch => {
      sdk.webhookEndpoints.retrieve.mockResolvedValue({ ...await endpoint(), ...mismatch });
      expect((await enable()).status).toBe(409); expect(sdk.webhookEndpoints.update).not.toHaveBeenCalled();
    });
  it('does not return provider errors, credentials or customer data', async () => {
    sdk.webhookEndpoints.retrieve.mockRejectedValue(new Error('fixture-secret private@example.com'));
    const response = await enable(); expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/fixture-secret|private@example/);
  });
});
describe('operator-only read-only billing diagnostics', () => {
  it.each([{ database_name: 'aisar_test', role_name: 'aisar_app' }, { database_name: 'neondb', role_name: 'neondb_owner' }])(
    'rejects the wrong actual database or an RLS-bypassing role before provider calls: %j', async identity => {
      sdk.databaseIdentity.mockResolvedValue([identity]);
      expect(await (await call()).json()).toMatchObject({ ready: false, checks: { databaseIdentity: false }, failures: ['database_identity'] });
      expect(sdk.accounts.retrieve).not.toHaveBeenCalled();
    });
  it.each(['', 'wrong'])('refuses an unauthorized key before provider calls: %s', async key => {
    expect((await call(key)).status).toBe(401); expect(sdk.accounts.retrieve).not.toHaveBeenCalled();
  });
  it('refuses mutations before provider calls', async () => {
    expect((await call('support-fixture', 'POST')).status).toBe(405); expect(sdk.accounts.retrieve).not.toHaveBeenCalled();
  });
  it('verifies the candidate without opening the deployed purchase or fulfillment gate', async () => {
    const configuration = env(), response = await call('support-fixture', 'GET', configuration);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ ok: true, ready: true, checkoutEnabled: false, failures: [] });
    expect(configuration.STRIPE_BILLING_LIVE_ENABLED).toBe('false'); expect(configuration.STRIPE_CHECKOUT_ENABLED).toBe('false');
  });
  it('rejects a test credential or mismatched production boundary without provider calls', async () => {
    const response = await call('support-fixture', 'GET', testEnv({ ...env(), STRIPE_SECRET_KEY: 'rk_test_fixture' }));
    expect(await response.json()).toMatchObject({ ready: false, checks: { configuration: false } });
    expect(sdk.accounts.retrieve).not.toHaveBeenCalled();
  });
  it('does not inspect remaining resources on the wrong seller', async () => {
    sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other', country: 'MY', charges_enabled: true });
    expect(await (await call()).json()).toMatchObject({ ready: false, checks: { account: false } });
    expect(sdk.prices.retrieve).not.toHaveBeenCalled(); expect(sdk.charges.list).not.toHaveBeenCalled();
  });
  it('reports a prepared disabled webhook without changing it', async () => {
    sdk.webhookEndpoints.list.mockResolvedValue({ has_more: false, data: [{ url: 'https://api.jentera.ai/api/webhooks/stripe',
      livemode: true, api_version: '2026-08-26.dahlia', metadata: { jentera_billing: 'jentera-launch-billing-v1' }, enabled_events: events, status: 'disabled' }] });
    expect(await (await call()).json()).toMatchObject({ ready: false, checks: { webhookConfiguration: true, webhookEnabled: false } });
  });
  it('does not call cancellation ready when disabled or immediate', async () => {
    sdk.billingPortal.configurations.list.mockResolvedValue({ has_more: false, data: [{ is_default: true, livemode: true, features: {
      subscription_cancel: { enabled: true, mode: 'immediately', proration_behavior: 'none' },
      payment_method_update: { enabled: true }, invoice_history: { enabled: true },
    } }] });
    expect(await (await call()).json()).toMatchObject({ ready: false, checks: { portalCancellation: false } });
  });
  it('never returns provider payloads or errors containing credentials/customer data', async () => {
    sdk.invoicePayments.list.mockRejectedValue(new Error('fixture-secret private@example.com'));
    sdk.charges.list.mockResolvedValue({ data: [{ billing_details: { email: 'private@example.com' } }] });
    const body = await (await call()).text();
    expect(JSON.parse(body)).toMatchObject({ ready: false, failures: ['payment_evidence'] });
    expect(body).not.toContain('fixture-secret'); expect(body).not.toContain('private@example.com');
  });
});
