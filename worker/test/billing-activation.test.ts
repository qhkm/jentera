import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, req, signIn, testEnv, truncateAll } from './harness';
import { handleBilling } from '../src/routes/billing';
import { handleStripeWebhook } from '../src/routes/stripe-webhook';
import { handleAccess } from '../src/routes/access';
import { businessHasAccess } from '../src/access';
import { verifySession } from '../src/auth';
import type { Env } from '../src/env';

const { sdk, adapter } = vi.hoisted(() => ({ adapter: { live: false }, sdk: {
  accounts: { retrieve: vi.fn() }, prices: { retrieve: vi.fn() }, coupons: { retrieve: vi.fn() },
  customers: { create: vi.fn() }, checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  subscriptions: { retrieve: vi.fn() }, invoices: { retrieve: vi.fn() },
  invoicePayments: { list: vi.fn() }, paymentIntents: { retrieve: vi.fn() },
} }));
// Outbound Stripe is substituted. Both modes use only the isolated Docker DB;
// production configuration isolation itself is covered in stripe.test.ts.
vi.mock('../src/stripe', async importActual => ({
  ...await importActual<typeof import('../src/stripe')>(), stripeClient: () => sdk,
  stripeIsLive: () => adapter.live, stripeCheckoutEnabled: () => true, stripeBillingEnabled: () => true, stripeWebhookEnabled: () => true,
  verifyStripeAccount: async () => {
    if (adapter.live && (await sdk.accounts.retrieve()).id !== 'acct_1UG90wHuvvz49fq3') throw new Error('wrong seller');
  },
}));
const SECRET = 'whsec_local_only', origin = 'https://jentera.ai';
const cors = { 'Access-Control-Allow-Origin': origin };
let cookie: string, user: string, business: string, useEnv: Env;
const start = Math.floor(Date.now() / 1000) - 60, end = start + 30 * 86400;
beforeEach(async () => {
  vi.clearAllMocks(); adapter.live = false; await truncateAll();
  await asOwner(sql => sql`truncate platform_access cascade`);
  const [row] = await asOwner(sql => sql`insert into app_user (email, email_verified) values ('activation@example.com', true) returning id`);
  user = row.id; cookie = await signIn(user);
  useEnv = testEnv({ ACCESS_MODE: 'waitlist', APP_ORIGIN: origin, STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_LAUNCH_PRODUCT: 'prod_launch', STRIPE_LAUNCH_MONTHLY_PRICE: 'price_launch', STRIPE_LAUNCH_COUPON: 'coupon_launch',
    LAUNCH_FOUNDER_GROUP_URL: `https://chat.whatsapp.com/${'A'.repeat(22)}` });
});
async function begin(live = false) {
  adapter.live = live;
  sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_1UG90wHuvvz49fq3' });
  sdk.prices.retrieve.mockResolvedValue({ id: 'price_launch', livemode: live, active: true, currency: 'myr', unit_amount: 19900,
    type: 'recurring', billing_scheme: 'per_unit', product: { id: 'prod_launch', active: true, livemode: live },
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } });
  sdk.coupons.retrieve.mockResolvedValue({ id: 'coupon_launch', livemode: live, valid: true, currency: 'myr', amount_off: 10000,
    percent_off: null, duration: 'repeating', duration_in_months: 3, applies_to: { products: ['prod_launch'] } });
  sdk.customers.create.mockResolvedValue({ id: 'cus_activation' });
  sdk.checkout.sessions.create.mockResolvedValue({ id: 'cs_activation', livemode: live,
    url: 'https://checkout.stripe.com/c/pay/activation-fixture', expires_at: end });
  const incoming = req('POST', '/api/billing/launch/checkout', { cookie, body: { plan: 'launch' } });
  incoming.request.headers.set('Origin', origin); incoming.request.headers.set('Idempotency-Key', crypto.randomUUID());
  const response = (await handleBilling(incoming.request, useEnv, incoming.url, cors))!;
  const [membership] = await asOwner(sql => sql`select business_id from membership where user_id=${user}`);
  business = membership.business_id;
  sdk.checkout.sessions.retrieve.mockResolvedValue({ id: 'cs_activation', livemode: live, mode: 'subscription', customer: 'cus_activation',
    subscription: 'sub_activation', client_reference_id: business, payment_status: 'paid' });
  sdk.subscriptions.retrieve.mockResolvedValue({ id: 'sub_activation', livemode: live, customer: 'cus_activation', status: 'active', latest_invoice: 'in_activation',
    items: { has_more: false, data: [{ quantity: 1, current_period_end: end, price: { id: 'price_launch', currency: 'myr' } }] } });
  sdk.invoices.retrieve.mockResolvedValue({ id: 'in_activation', livemode: live, customer: 'cus_activation', currency: 'myr', status: 'paid',
    amount_paid: 9900, amount_remaining: 0, amount_due: 9900, total: 9900, starting_balance: 0, ending_balance: 0,
    billing_reason: 'subscription_create', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_activation' } },
    lines: { has_more: false, data: [{ quantity: 1, amount: 19900, period: { start, end }, pricing: { price_details: { price: 'price_launch' } },
      parent: { type: 'subscription_item_details', subscription_item_details: { proration: false } } }] } });
  sdk.invoicePayments.list.mockResolvedValue({ has_more: false, data: [{ invoice: 'in_activation', livemode: live, currency: 'myr', amount_paid: 9900,
    payment: { type: 'payment_intent', payment_intent: 'pi_activation' } }] });
  sdk.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_activation', livemode: live, status: 'succeeded', currency: 'myr', amount_received: 9900, customer: 'cus_activation',
    latest_charge: { id: 'ch_activation', livemode: live, customer: 'cus_activation', payment_intent: 'pi_activation', currency: 'myr',
      amount: 9900, status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false } });
  return response;
}
async function deliver(live = adapter.live, overrides = {}) {
  const payload = JSON.stringify({ id: `evt_${crypto.randomUUID().replace(/-/g, '')}`, type: 'checkout.session.completed',
    api_version: '2026-08-26.dahlia', livemode: live, data: { object: { id: 'cs_activation' } }, ...overrides });
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const incoming = req('POST', '/api/webhooks/stripe');
  return (await handleStripeWebhook(new Request(incoming.url, { method: 'POST', body: payload,
    headers: { 'Stripe-Signature': `t=${ts},v1=${signature}` } }), useEnv, incoming.url))!;
}
const access = async () => {
  const incoming = req('GET', '/api/access', { cookie });
  return (await handleAccess(incoming.request, useEnv, incoming.url, cors))!.json() as Promise<{ access: { allowed: boolean; kind: string }; founderGroup: unknown }>;
};
describe('checkout → signed confirmation → real access gate', () => {
  it.each([false, true])('activates only the verified payer and support invite after payment (live adapter=%s)', async live => {
    expect((await begin(live)).status).toBe(200);
    expect(await access()).toMatchObject({ access: { allowed: false }, founderGroup: null });
    expect(await businessHasAccess(useEnv, business)).toBe(false);
    expect((await deliver()).status).toBe(200);
    expect(await access()).toMatchObject({ access: { allowed: true, kind: 'paid' }, founderGroup: { url: useEnv.LAUNCH_FOUNDER_GROUP_URL } });
    expect(await businessHasAccess(useEnv, business)).toBe(true);
    const token = decodeURIComponent(cookie.split('=')[1]);
    expect(await verifySession(useEnv, token)).toMatchObject({ userId: user, businessId: business });
    expect(await asOwner(sql => sql`select * from billing_payment`)).toHaveLength(1);
    expect(await asOwner(sql => sql`select * from agent_runtime`)).toHaveLength(0);
    const incoming = req('GET', '/api/billing/status', { cookie });
    expect(await (await handleBilling(incoming.request, useEnv, incoming.url, cors))!.json()).toMatchObject({ activation: 'active', state: { paid_access_active: true } });
  });
  it('rejects a sandbox receipt in the live adapter', async () => {
    await begin(true); expect((await deliver(false)).status).toBe(400);
    expect((await access()).access.allowed).toBe(false);
  });
  it('rejects an unexpected webhook API version', async () => {
    await begin(true); expect((await deliver(true, { api_version: '2020-08-27' })).status).toBe(400);
    expect((await access()).access.allowed).toBe(false);
  });
  it('does not activate a payment when the seller account check fails', async () => {
    await begin(true); sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await deliver()).status).toBe(500); expect((await access()).access.allowed).toBe(false);
    vi.restoreAllMocks();
  });
  it('rejects an unexpected live paid amount, even with a successful intent', async () => {
    await begin(true); const invoice = await sdk.invoices.retrieve(); const intent = await sdk.paymentIntents.retrieve();
    sdk.invoices.retrieve.mockResolvedValue({ ...invoice, amount_paid: 100, amount_due: 100, total: 100 });
    sdk.invoicePayments.list.mockResolvedValue({ has_more: false, data: [{ invoice: 'in_activation', livemode: true, currency: 'myr', amount_paid: 100,
      payment: { type: 'payment_intent', payment_intent: 'pi_activation' } }] });
    sdk.paymentIntents.retrieve.mockResolvedValue({ ...intent, amount_received: 100, latest_charge: { ...intent.latest_charge, amount: 100 } });
    expect((await deliver()).status).toBe(200); expect((await access()).access.allowed).toBe(false);
  });
});
