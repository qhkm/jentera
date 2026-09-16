import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { asOwner, req, signIn, testEnv, truncateAll } from './harness';
import { handleBilling } from '../src/routes/billing';
import { verifiedLaunchCatalog } from '../src/billing/launch-catalog';

const { sdk } = vi.hoisted(() => ({ sdk: {
  prices: { retrieve: vi.fn() }, coupons: { retrieve: vi.fn() }, customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
} }));
vi.mock('../src/stripe', async importActual => ({
  ...await importActual<typeof import('../src/stripe')>(), stripeClient: () => sdk,
}));
const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };
const env = () => testEnv({ ACCESS_MODE: 'waitlist', STRIPE_BILLING_SANDBOX_ENABLED: 'true',
  STRIPE_CHECKOUT_ENABLED: 'true',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_only',
  STRIPE_SECRET_KEY: 'rk_test_fixture', STRIPE_LAUNCH_PRODUCT: 'prod_launch',
  STRIPE_LAUNCH_MONTHLY_PRICE: 'price_launch', STRIPE_LAUNCH_COUPON: 'coupon_launch',
  APP_ORIGIN: 'https://jentera.ai' });
const price = () => ({ id: 'price_launch', active: true, livemode: false, currency: 'myr',
  unit_amount: 19900, type: 'recurring', billing_scheme: 'per_unit',
  product: { id: 'prod_launch', active: true, livemode: false },
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
});
const coupon = () => ({ id: 'coupon_launch', valid: true, livemode: false, currency: 'myr',
  amount_off: 10000, percent_off: null, duration: 'repeating', duration_in_months: 3,
  applies_to: { products: ['prod_launch'] },
});
let userId: string, cookie: string;
beforeEach(async () => {
  vi.clearAllMocks(); await truncateAll();
  await asOwner(sql => sql`truncate platform_access cascade`);
  const [user] = await asOwner(sql => sql`insert into app_user (email, email_verified)
    values ('launch-owner@example.com', true) returning id`);
  userId = user.id; cookie = await signIn(userId);
  sdk.prices.retrieve.mockResolvedValue(price()); sdk.coupons.retrieve.mockResolvedValue(coupon());
  sdk.customers.create.mockResolvedValue({ id: 'cus_launch' });
  sdk.checkout.sessions.create.mockResolvedValue({ id: 'cs_launch', livemode: false,
    url: 'https://checkout.stripe.com/c/pay/fixture', expires_at: Math.floor(Date.now() / 1000) + 3600 });
});
afterEach(() => vi.restoreAllMocks());
async function checkout(body: unknown = { plan: 'launch' }, key = crypto.randomUUID(), useEnv = env(), useCookie = cookie) {
  const incoming = req('POST', '/api/billing/launch/checkout', { cookie: useCookie, body });
  incoming.request.headers.set('Origin', cors['Access-Control-Allow-Origin']);
  incoming.request.headers.set('Idempotency-Key', key);
  return (await handleBilling(incoming.request, useEnv, incoming.url, cors))!;
}

describe('one-plan launch checkout in an isolated sandbox', () => {
  it('creates one private onboarding business, not compute or paid access, for a verified new payer', async () => {
    expect((await checkout()).status).toBe(200);
    const rows = await asOwner(sql => sql`select b.plan, b.onboarded, b.setup_done, m.role
      from business b join membership m on m.business_id=b.id where m.user_id=${userId}`);
    expect(rows).toMatchObject([{ plan: 'free', onboarded: false, setup_done: false, role: 'owner' }]);
    expect(await asOwner(sql => sql`select * from agent_runtime`)).toHaveLength(0);
    expect(await asOwner(sql => sql`select * from platform_access`)).toHaveLength(0);
    expect(await asOwner(sql => sql`select * from specialist_profile`)).toHaveLength(4);
    const [params] = sdk.checkout.sessions.create.mock.calls[0];
    expect(params).toMatchObject({ mode: 'subscription', line_items: [{ price: 'price_launch', quantity: 1 }],
      discounts: [{ coupon: 'coupon_launch' }], consent_collection: { terms_of_service: 'required' },
      adaptive_pricing: { enabled: false } });
    expect(params.custom_text.submit.message).toContain('RM99/month');
    expect(params.custom_text.submit.message).toContain('then RM199/month');
    expect(params).not.toHaveProperty('subscription_data');
    expect(params).not.toHaveProperty('payment_method_types');
  });
  it('serializes two pre-membership tabs into one business and one provider checkout', async () => {
    const responses = await Promise.all([checkout(), checkout()]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await asOwner(sql => sql`select * from business`)).toHaveLength(1);
    expect(sdk.customers.create).toHaveBeenCalledTimes(1);
    expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('does not create a business when the launch is disabled or the key is live', async () => {
    expect((await checkout({ plan: 'launch' }, crypto.randomUUID(), testEnv())).status).toBe(503);
    expect((await checkout({ plan: 'launch' }, crypto.randomUUID(), {
      ...env(), STRIPE_SECRET_KEY: ['rk', 'live', 'fixture'].join('_'),
    })).status).toBe(503);
    expect(await asOwner(sql => sql`select * from business`)).toHaveLength(0);
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it.each([{ plan: 'launch', amount: 1 }, { plan: 'launch', price: 'price_other' },
    { plan: 'launch', interval: 'year' }, { plan: 'pro' }, null])('refuses invalid requests before creating ownership: %j', async body => {
    expect((await checkout(body)).status).toBe(400);
    expect(await asOwner(sql => sql`select * from business`)).toHaveLength(0);
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('requires a request key before creating a first-purchase business', async () => {
    expect((await checkout({ plan: 'launch' }, '')).status).toBe(400);
    expect(await asOwner(sql => sql`select * from business`)).toHaveLength(0);
  });
  it('refuses an unverified or security-suspended payer without creating a business', async () => {
    await asOwner(sql => sql`update app_user set email_verified=false where id=${userId}`);
    expect((await checkout()).status).toBe(401);
    await asOwner(sql => sql`update app_user set email_verified=true where id=${userId}`);
    await asOwner(sql => sql`insert into platform_access (email, kind, expires_at, revoked_at)
      values ('launch-owner@example.com', 'trial', now()+interval '3 days', now())`);
    expect((await checkout()).status).toBe(403);
    expect(await asOwner(sql => sql`select * from business`)).toHaveLength(0);
  });
  it('returns a read-only billing status for a new account without creating a business', async () => {
    const incoming = req('GET', '/api/billing/status', { cookie });
    const response = await handleBilling(incoming.request, env(), incoming.url, cors);
    expect(await response!.json()).toMatchObject({ state: null, sandboxOnly: true, creditEnforcementEnabled: false });
    expect(await asOwner(sql => sql`select * from business`)).toHaveLength(0);
  });
  it('checks account payment history beyond the current tenant before applying the offer', async () => {
    const other = crypto.randomUUID();
    await asOwner(async sql => {
      await sql`insert into business (id, name, playbook_key) values (${other}, 'Previous business', 'generic')`;
      await sql`insert into billing_payment (invoice_id, business_id, subscription_id, customer_id,
        payment_intent_id, payer_user_id, amount_minor, currency, period_start, period_end)
        values ('in_previous', ${other}, 'sub_previous', 'cus_previous', 'pi_previous', ${userId},
          9900, 'myr', now()-interval '2 months', now()-interval '1 month')`;
    });
    expect((await checkout()).status).toBe(200);
    expect(sdk.checkout.sessions.create.mock.calls[0][0].discounts).toEqual([]);
    expect(sdk.checkout.sessions.create.mock.calls[0][0].custom_text.submit.message).toContain('RM199/month');
    expect(sdk.coupons.retrieve).not.toHaveBeenCalled();
  });
});

describe('canonical launch catalog validation', () => {
  it.each([
    { currency: 'usd' }, { unit_amount: 9900 }, { active: false }, { livemode: true },
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', trial_period_days: 14 } },
    { product: { id: 'prod_other', active: true, livemode: false } },
    { currency_options: { usd: { unit_amount: 19900 } } },
    { currency_options: { myr: { unit_amount: 9900 } } },
  ])('rejects a mismatched base price: %j', async change => {
    sdk.prices.retrieve.mockResolvedValue({ ...price(), ...change });
    await expect(verifiedLaunchCatalog(env(), sdk as unknown as Stripe, true)).rejects.toThrow();
  });
  it.each([
    { amount_off: 9900 }, { duration: 'forever' }, { duration_in_months: 4 }, { valid: false },
    { livemode: true }, { applies_to: { products: ['prod_launch', 'prod_other'] } },
    { applies_to: undefined }, { percent_off: 50 }, { currency: 'usd' },
  ])('rejects an unsafe discount: %j', async change => {
    sdk.coupons.retrieve.mockResolvedValue({ ...coupon(), ...change });
    await expect(verifiedLaunchCatalog(env(), sdk as unknown as Stripe, true)).rejects.toThrow();
  });
});
