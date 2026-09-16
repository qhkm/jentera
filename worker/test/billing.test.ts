import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';
import { handleBilling } from '../src/routes/billing';
const { sdk } = vi.hoisted(() => ({ sdk: { customers: { create: vi.fn() }, prices: { retrieve: vi.fn() },
  checkout: { sessions: { create: vi.fn() } }, billingPortal: { sessions: { create: vi.fn() } } } }));
vi.mock('../src/stripe', async importActual => ({ ...await importActual<typeof import('../src/stripe')>(), stripeClient: () => sdk }));
const ONE = '11111111-1111-4111-8111-111111111111', TWO = '22222222-2222-4222-8222-222222222222';
const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };
const env = () => testEnv({ STRIPE_BILLING_SANDBOX_ENABLED: 'true', STRIPE_SECRET_KEY: 'rk_test_fixture',
  STRIPE_CHECKOUT_ENABLED: 'true',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_only',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro', STRIPE_PRICE_TEAM_MONTHLY: 'price_team', APP_ORIGIN: 'https://jentera.ai' });
let cookie: string, staffCookie: string, otherUser: string;
beforeEach(async () => {
  vi.clearAllMocks(); await truncateAll();
  const users = await asOwner(async sql => {
    await sql`truncate platform_access cascade`;
    await sql`insert into business (id, name, playbook_key, plan) values (${ONE}, 'One', 'generic', 'team'), (${TWO}, 'Two', 'generic', 'free')`;
    const users = await sql`insert into app_user (email, email_verified) values ('payer@example.com', true), ('staff@example.com', true), ('other@example.com', true) returning id, email`;
    const by = Object.fromEntries(users.map(row => [row.email.split('@')[0], row.id]));
    await sql`insert into membership (user_id, business_id, role) values (${by.payer}, ${ONE}, 'owner'), (${by.staff}, ${ONE}, 'staff'), (${by.other}, ${TWO}, 'owner')`;
    return by;
  });
  cookie = await signIn(users.payer); staffCookie = await signIn(users.staff); otherUser = users.other;
  sdk.customers.create.mockResolvedValue({ id: 'cus_one' });
  sdk.prices.retrieve.mockResolvedValue({ active: true, livemode: false, currency: 'myr', type: 'recurring', unit_amount: 9900, recurring: { interval: 'month', interval_count: 1 } });
  sdk.checkout.sessions.create.mockResolvedValue({ id: 'cs_one', livemode: false, url: 'https://checkout.stripe.com/c/pay/test', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  sdk.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/session/test' });
});
afterEach(() => vi.restoreAllMocks());
async function call(path: string, key = crypto.randomUUID(), useEnv = env(), useCookie = cookie, body: unknown = { plan: 'pro' }) {
  const incoming = req(path.endsWith('/status') ? 'GET' : 'POST', path, { cookie: useCookie, body });
  incoming.request.headers.set('Origin', 'https://jentera.ai'); incoming.request.headers.set('Idempotency-Key', key);
  return (await handleBilling(incoming.request, useEnv, incoming.url, cors))!;
}
describe('owner-only sandbox Checkout intake', () => {
  it('keeps cancellation available while new purchases are paused, even during tax review', async () => {
    const paused = testEnv({ ...env(), STRIPE_CHECKOUT_ENABLED: 'false', STRIPE_AUTOMATIC_TAX: 'true' });
    expect((await call('/api/billing/checkout', crypto.randomUUID(), paused)).status).toBe(503);
    await asTenant(ONE, tx => tx`update business set stripe_customer_id='cus_one' where id=${ONE}`);
    expect((await call('/api/billing/portal', crypto.randomUUID(), paused)).status).toBe(200);
    expect(sdk.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('can reapply additive migrations without losing payment/event safety', async () => {
    const files = ['053_stripe_billing.sql', '054_billing_payment_evidence.sql', '055_launch_purchase_eligibility.sql', '056_billing_lifecycle.sql'];
    const migrations = await Promise.all(files.map(file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')));
    await asOwner(async sql => { for (const migration of migrations) await sql.unsafe(migration); });
    const result = await asTenant(ONE, tx => tx`select
      not has_table_privilege('aisar_app', 'public.stripe_event', 'delete') as immutable_event,
      not has_table_privilege('aisar_app', 'public.billing_payment', 'delete') as immutable_payment`);
    expect(result).toMatchObject([{ immutable_event: true, immutable_payment: true }]);
  });
  it('requires explicit enablement and rejects live keys even with the flag enabled', async () => {
    expect((await call('/api/billing/checkout', crypto.randomUUID(), testEnv())).status).toBe(503);
    expect((await call('/api/billing/checkout', crypto.randomUUID(), testEnv({ ...env(), STRIPE_SECRET_KEY: ['rk', 'live', 'fixture'].join('_') }))).status).toBe(503);
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('persists customer and checkout ownership before returning a URL, without granting paid access', async () => {
    const key = crypto.randomUUID(), response = await call('/api/billing/checkout', key);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await asTenant(ONE, tx => tx`select stripe_session_id, payer_user_id from billing_checkout`)).toMatchObject([{ stripe_session_id: 'cs_one', payer_user_id: expect.any(String) }]);
    expect(await asOwner(sql => sql`select * from platform_access`)).toHaveLength(0);
    const [params, options] = sdk.checkout.sessions.create.mock.calls[0];
    expect(params).toMatchObject({ customer: 'cus_one', mode: 'subscription', client_reference_id: ONE, success_url: 'https://jentera.ai/subscribe?checkout=complete' });
    expect(params).not.toHaveProperty('payment_method_types'); expect(params.integration_identifier).toMatch(/^jentera-[a-z]{8}$/);
    expect(options.idempotencyKey).toBe(`jentera-checkout-${ONE}-${key}`);
  });
  it('deduplicates double-taps and concurrent different request keys', async () => {
    const key = crypto.randomUUID();
    expect((await Promise.all([call('/api/billing/checkout', key), call('/api/billing/checkout', key), call('/api/billing/checkout')])).map(response => response.status)).toEqual([200, 200, 200]);
    expect(sdk.customers.create).toHaveBeenCalledTimes(1); expect(sdk.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it('rejects conflicting plan requests while Checkout is open', async () => {
    const key = crypto.randomUUID(); await call('/api/billing/checkout', key);
    expect((await call('/api/billing/checkout', key, env(), cookie, { plan: 'team' })).status).toBe(409);
    expect((await call('/api/billing/checkout', crypto.randomUUID(), env(), cookie, { plan: 'team' })).status).toBe(409);
  });
  it('rejects foreign idempotency keys without creating an orphan paid checkout', async () => {
    const key = crypto.randomUUID();
    await asOwner(sql => sql`insert into billing_checkout (id, business_id, payer_user_id, price_id, plan, interval) values (${key}, ${TWO}, ${otherUser}, 'price_pro', 'pro', 'month')`);
    expect((await call('/api/billing/checkout', key)).status).toBe(409); expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('allows a verified owner with expired/restricted access to reach billing only', async () => {
    expect((await call('/api/billing/checkout', crypto.randomUUID(), testEnv({ ...env(), ACCESS_MODE: 'waitlist' }))).status).toBe(200);
    expect(await asOwner(sql => sql`select * from platform_access`)).toHaveLength(0);
  });
  it('does not let a security-suspended account create a new paid checkout', async () => {
    await asOwner(sql => sql`insert into platform_access (email, kind, expires_at, revoked_at, note)
      values ('payer@example.com', 'trial', now()+interval '1 day', now(), 'security suspension')`);
    expect((await call('/api/billing/checkout')).status).toBe(403);
    expect(sdk.customers.create).not.toHaveBeenCalled(); expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('refuses staff and unauthenticated requests', async () => {
    expect((await call('/api/billing/checkout', crypto.randomUUID(), env(), staffCookie)).status).toBe(403);
    expect((await call('/api/billing/checkout', crypto.randomUUID(), env(), '')).status).toBe(401);
  });
  it('rejects a foreign origin before any provider operation', async () => {
    const incoming = req('POST', '/api/billing/checkout', { cookie, body: { plan: 'pro' } });
    incoming.request.headers.set('Origin', 'https://evil.example');
    expect((await handleBilling(incoming.request, env(), incoming.url, cors))!.status).toBe(403);
    expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('requires a request key and validates price currency/interval', async () => {
    expect((await call('/api/billing/checkout', '')).status).toBe(400);
    sdk.prices.retrieve.mockResolvedValue({ active: true, currency: 'usd', type: 'recurring', recurring: { interval: 'month' } });
    expect((await call('/api/billing/checkout')).status).toBe(503); expect(sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('blocks tax enablement until registration and launch review', async () => {
    expect((await call('/api/billing/checkout', crypto.randomUUID(), testEnv({ ...env(), STRIPE_AUTOMATIC_TAX: 'true' }))).status).toBe(503);
  });
  it('returns safe provider errors without exposing keys, addresses or upstream details', async () => {
    sdk.checkout.sessions.create.mockRejectedValue(new Error('private upstream details should never escape'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await call('/api/billing/checkout'); expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private upstream');
    expect(await asTenant(ONE, tx => tx`select * from billing_checkout`)).toHaveLength(0);
  });
  it('keeps the credit enforcement status explicit rather than pretending it is connected', async () => {
    const response = await call('/api/billing/status');
    expect(await response.json()).toMatchObject({ sandboxOnly: true, creditEnforcementEnabled: false, activation: 'inactive', state: { paid_access_active: false } });
  });
});
