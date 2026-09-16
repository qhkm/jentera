import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';
import { handleStripeWebhook } from '../src/routes/stripe-webhook';

const { sdk } = vi.hoisted(() => ({ sdk: {
  subscriptions: { retrieve: vi.fn() }, checkout: { sessions: { retrieve: vi.fn() } },
  invoices: { retrieve: vi.fn() }, invoicePayments: { list: vi.fn() }, paymentIntents: { retrieve: vi.fn() },
  charges: { retrieve: vi.fn() }, disputes: { retrieve: vi.fn() },
} }));
vi.mock('../src/stripe', async importActual => ({ ...await importActual<typeof import('../src/stripe')>(), stripeClient: () => sdk }));
const ONE = '11111111-1111-4111-8111-111111111111', TWO = '22222222-2222-4222-8222-222222222222';
const SECRET = 'whsec_test_only';
const env = () => testEnv({ STRIPE_SECRET_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_BILLING_SANDBOX_ENABLED: 'true', STRIPE_PRICE_PRO_MONTHLY: 'price_pro' });
let owner: string;
const start = Math.floor(Date.now() / 1000) - 60, end = start + 30 * 86_400;
function subscription() {
  return { id: 'sub_one', customer: 'cus_one', status: 'active', livemode: false, latest_invoice: 'in_one',
    items: { has_more: false, data: [{ quantity: 1, current_period_start: start, current_period_end: end,
      price: { id: 'price_pro', currency: 'myr', recurring: { interval: 'month' } } }] } };
}
function session() {
  return { id: 'cs_one', mode: 'subscription', livemode: false, customer: 'cus_one', subscription: 'sub_one', client_reference_id: ONE, payment_status: 'paid' };
}
function invoice() {
  return { id: 'in_one', status: 'paid', currency: 'myr', livemode: false, customer: 'cus_one', amount_paid: 9900, amount_remaining: 0,
    billing_reason: 'subscription_create', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_one' } },
    lines: { has_more: false, data: [{ quantity: 1, amount: 9900, pricing: { price_details: { price: 'price_pro' } },
      parent: { type: 'subscription_item_details', subscription_item_details: { proration: false } }, period: { start, end } }] } };
}
beforeEach(async () => {
  vi.clearAllMocks(); await truncateAll();
  await asOwner(async sql => {
    await sql`truncate platform_access cascade`;
    await sql`insert into business (id, name, playbook_key, stripe_customer_id) values (${ONE}, 'One', 'generic', 'cus_one'), (${TWO}, 'Two', 'generic', 'cus_two')`;
    const [user] = await sql`insert into app_user (email, email_verified) values ('payer@example.com', true) returning id`;
    owner = user.id;
    await sql`insert into membership (user_id, business_id, role) values (${owner}, ${ONE}, 'owner')`;
    await sql`insert into billing_checkout (id, business_id, payer_user_id, price_id, plan, interval, stripe_session_id)
      values (${crypto.randomUUID()}, ${ONE}, ${owner}, 'price_pro', 'pro', 'month', 'cs_one')`;
  });
  sdk.subscriptions.retrieve.mockResolvedValue(subscription()); sdk.checkout.sessions.retrieve.mockResolvedValue(session());
  sdk.invoices.retrieve.mockResolvedValue(invoice());
  sdk.invoicePayments.list.mockResolvedValue({ has_more: false, data: [{ invoice: 'in_one', status: 'paid', livemode: false, currency: 'myr', amount_paid: 9900,
    payment: { type: 'payment_intent', payment_intent: 'pi_one' } }] });
  sdk.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_one', livemode: false, status: 'succeeded', currency: 'myr', amount_received: 9900, customer: 'cus_one',
    latest_charge: { id: 'ch_one', livemode: false, customer: 'cus_one', payment_intent: 'pi_one', currency: 'myr', amount: 9900,
      status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false } });
  sdk.charges.retrieve.mockResolvedValue({ id: 'ch_one', livemode: false, customer: 'cus_one', payment_intent: 'pi_one', amount_refunded: 9900 });
  sdk.disputes.retrieve.mockResolvedValue({ id: 'dp_one', charge: 'ch_one', status: 'needs_response' });
});
afterEach(() => vi.restoreAllMocks());
async function delivery(type: string, eventId = crypto.randomUUID().replace(/-/g, ''), overrides: Record<string, unknown> = {}, useEnv = env()) {
  const object = type.startsWith('checkout.') ? { id: 'cs_one', customer: 'cus_one' }
    : type.startsWith('invoice.') ? { id: 'in_one', customer: 'cus_one' }
    : type.startsWith('charge.dispute.') ? { id: 'dp_one' }
    : type.startsWith('charge.') ? { id: 'ch_one' } : { id: 'sub_one', customer: 'cus_one' };
  const payload = JSON.stringify({ id: `evt_${eventId}`, type, livemode: false, data: { object }, ...overrides });
  const ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`)));
  const signature = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const url = new URL('https://api.test/api/webhooks/stripe');
  return (await handleStripeWebhook(new Request(url, { method: 'POST', body: payload, headers: { 'Stripe-Signature': `t=${ts},v1=${signature}` } }), useEnv, url))!;
}
const state = () => asTenant(ONE, async tx => {
  const [business] = await tx`select plan, stripe_subscription_id, stripe_subscription_status, stripe_current_period_end, stripe_paid_through from business`;
  return business;
});
const payments = () => asTenant(ONE, tx => tx`select * from billing_payment`);
const grants = () => asOwner(sql => sql`select * from platform_access`);

describe('payment-confirmed sandbox lifecycle on real Postgres', () => {
  it('continues automatic payment fulfillment while new checkout is paused', async () => {
    const paused = testEnv({ ...env(), STRIPE_CHECKOUT_ENABLED: 'false' });
    expect((await delivery('invoice.paid', 'closed_checkout', {}, paused)).status).toBe(200);
    expect(await grants()).toMatchObject([{ kind: 'paid' }]);
  });
  it('keeps both foreground and background access closed before payment, then activates automatically', async () => {
    const { accessForEmail, businessHasAccess } = await import('../src/access');
    const restricted = testEnv({ ...env(), ACCESS_MODE: 'waitlist' });
    expect((await accessForEmail(restricted, 'payer@example.com')).allowed).toBe(false);
    expect(await businessHasAccess(restricted, ONE)).toBe(false);
    await delivery('invoice.paid', 'automatic', {}, restricted);
    expect((await accessForEmail(restricted, 'payer@example.com')).kind).toBe('paid');
    expect(await businessHasAccess(restricted, ONE)).toBe(true);
    expect((await accessForEmail(restricted, 'another@example.com')).allowed).toBe(false);
    expect(await businessHasAccess(restricted, TWO)).toBe(false);
  });
  it('retains already-paid access when cancellation is scheduled for period end', async () => {
    await delivery('invoice.paid');
    sdk.subscriptions.retrieve.mockResolvedValue({ ...subscription(), cancel_at_period_end: true });
    await delivery('customer.subscription.updated');
    expect((await grants())[0].expires_at).toEqual(new Date(end * 1000));
    expect(await state()).toMatchObject({ plan: 'pro' });
  });
  it.each(['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'])('pauses Stripe-owned access for review after %s and never reopens it on renewal', async type => {
    await delivery('invoice.paid'); await delivery(type);
    expect((await grants())[0].expires_at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await state()).toMatchObject({ plan: 'free' });
    await delivery('invoice.paid', 'reordered'); await delivery('customer.subscription.updated');
    expect((await grants())[0].expires_at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await asTenant(ONE, tx => tx`select * from billing_payment_adjustment`)).toHaveLength(1);
    expect(await asTenant(TWO, tx => tx`select * from billing_payment_adjustment`)).toHaveLength(0);
  });
  it('rejects a refund whose freshly retrieved charge belongs to another customer', async () => {
    await delivery('invoice.paid'); sdk.charges.retrieve.mockResolvedValue({ id: 'ch_one', livemode: false, customer: 'cus_two', payment_intent: 'pi_one', amount_refunded: 9900 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await delivery('charge.refunded')).status).toBe(500);
    expect((await grants())[0].expires_at).toEqual(new Date(end * 1000));
  });
  it('reconciles stored payment evidence after a later active subscription update', async () => {
    sdk.subscriptions.retrieve.mockResolvedValue({ ...subscription(), status: 'incomplete' });
    await delivery('invoice.paid'); expect(await grants()).toHaveLength(0); expect(await payments()).toHaveLength(1);
    sdk.subscriptions.retrieve.mockResolvedValue(subscription()); await delivery('customer.subscription.updated');
    expect(await grants()).toMatchObject([{ kind: 'paid' }]); expect(await payments()).toHaveLength(1);
  });
  it('does not make a trialing subscription paid even when an invoice callback arrives', async () => {
    sdk.subscriptions.retrieve.mockResolvedValue({ ...subscription(), status: 'trialing' });
    await delivery('invoice.paid'); expect(await grants()).toHaveLength(0);
  });
  it('grants coverage and one appreciation intent atomically without inventing credit entitlements', async () => {
    expect((await delivery('checkout.session.completed')).status).toBe(200);
    expect(await state()).toMatchObject({ plan: 'pro', stripe_subscription_id: 'sub_one', stripe_subscription_status: 'active', stripe_paid_through: new Date(end * 1000) });
    expect(await payments()).toHaveLength(1); expect(await grants()).toMatchObject([{ kind: 'paid', note: 'stripe:sub_one:in_one' }]);
    expect(await asTenant(ONE, tx => tx`select * from billing_appreciation_outbox`)).toHaveLength(1);
  });
  it('does not grant anything for an unpaid or no-payment-required checkout', async () => {
    for (const payment_status of ['unpaid', 'no_payment_required']) {
      sdk.checkout.sessions.retrieve.mockResolvedValue({ ...session(), payment_status });
      expect((await delivery('checkout.session.completed')).status).toBe(200);
    }
    expect(await state()).toMatchObject({ plan: 'free', stripe_paid_through: null }); expect(await payments()).toHaveLength(0); expect(await grants()).toHaveLength(0);
  });
  it('fulfills delayed success but never delayed failure', async () => {
    sdk.checkout.sessions.retrieve.mockResolvedValue({ ...session(), payment_status: 'unpaid' });
    expect((await delivery('checkout.session.async_payment_failed')).status).toBe(200); expect(await grants()).toHaveLength(0);
    sdk.checkout.sessions.retrieve.mockResolvedValue(session());
    expect((await delivery('checkout.session.async_payment_succeeded')).status).toBe(200); expect(await payments()).toHaveLength(1);
  });
  it('does not grant paid access based on subscription active/trial status alone', async () => {
    expect((await delivery('customer.subscription.created')).status).toBe(200);
    expect(await state()).toMatchObject({ plan: 'free' }); expect(await grants()).toHaveLength(0);
    sdk.subscriptions.retrieve.mockResolvedValue({ ...subscription(), status: 'trialing' });
    expect((await delivery('customer.subscription.updated')).status).toBe(200); expect(await grants()).toHaveLength(0);
  });
  it('handles invoice-before-checkout delivery through the saved Checkout ownership', async () => {
    expect((await delivery('invoice.paid')).status).toBe(200); expect(await payments()).toHaveLength(1);
    expect((await delivery('checkout.session.completed')).status).toBe(200); expect(await payments()).toHaveLength(1);
  });
  it('preserves subscription ID and item period on invoice payment failure', async () => {
    await delivery('checkout.session.completed'); sdk.subscriptions.retrieve.mockResolvedValue({ ...subscription(), status: 'past_due' });
    await delivery('invoice.payment_failed');
    expect(await state()).toMatchObject({ stripe_subscription_id: 'sub_one', stripe_current_period_end: new Date(end * 1000), stripe_paid_through: new Date(end * 1000), stripe_subscription_status: 'past_due' });
    expect(await payments()).toHaveLength(1);
  });
  it('deduplicates concurrent redeliveries and different events for the same invoice', async () => {
    expect((await Promise.all([delivery('invoice.paid', 'same'), delivery('invoice.paid', 'same')])).map(response => response.status)).toEqual([200, 200]);
    await delivery('invoice.paid', 'different'); await delivery('checkout.session.completed');
    expect(await payments()).toHaveLength(1);
    expect(await asTenant(ONE, tx => tx`select * from billing_appreciation_outbox`)).toHaveLength(1);
  });
  it('rolls back the claim and payment/access effects, then permits a retry', async () => {
    await asOwner(async sql => {
      await sql.unsafe(`create function billing_test_fail_grant() returns trigger language plpgsql as $$ begin raise exception 'test transaction failure'; end $$`);
      await sql.unsafe('create trigger billing_test_fail_grant before insert on platform_access for each row execute function billing_test_fail_grant()');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await delivery('invoice.paid', 'retry')).status).toBe(500);
    expect(await asOwner(sql => sql`select * from stripe_event`)).toHaveLength(0); expect(await grants()).toHaveLength(0);
    expect(await payments()).toHaveLength(0);
    await asOwner(async sql => {
      await sql.unsafe('drop trigger billing_test_fail_grant on platform_access');
      await sql.unsafe('drop function billing_test_fail_grant()');
    });
    expect((await delivery('invoice.paid', 'retry')).status).toBe(200); expect(await payments()).toHaveLength(1);
  });
  it('never clears an operator security revocation after successful payment', async () => {
    await asOwner(sql => sql`insert into platform_access (email, kind, expires_at, revoked_at, note) values ('payer@example.com', 'trial', now()+interval '1 day', now(), 'security suspension')`);
    await delivery('invoice.paid'); expect(await grants()).toMatchObject([{ kind: 'trial', note: 'security suspension', revoked_at: expect.any(Date) }]);
  });
  it('cancellation expires only Stripe-owned access without erasing audit identity', async () => {
    await delivery('invoice.paid'); sdk.subscriptions.retrieve.mockResolvedValue({ ...subscription(), status: 'canceled' });
    await delivery('customer.subscription.deleted');
    expect(await state()).toMatchObject({ plan: 'free', stripe_subscription_id: 'sub_one', stripe_subscription_status: 'canceled' });
    expect((await grants())[0].expires_at.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it.each(['zero', 'wrong-currency', 'manual', 'prorated', 'unconfirmed', 'refunded', 'disputed'])('rejects %s as paid entitlement evidence', async reason => {
    if (reason === 'zero') sdk.invoices.retrieve.mockResolvedValue({ ...invoice(), amount_paid: 0 });
    if (reason === 'wrong-currency') sdk.invoices.retrieve.mockResolvedValue({ ...invoice(), currency: 'usd' });
    if (reason === 'manual') sdk.invoices.retrieve.mockResolvedValue({ ...invoice(), parent: null });
    if (reason === 'prorated') {
      const data = invoice(); data.lines.data[0].parent.subscription_item_details.proration = true; sdk.invoices.retrieve.mockResolvedValue(data);
    }
    if (reason === 'unconfirmed') sdk.invoicePayments.list.mockResolvedValue({ has_more: false, data: [] });
    if (reason === 'refunded' || reason === 'disputed') {
      const intent = await sdk.paymentIntents.retrieve();
      sdk.paymentIntents.retrieve.mockResolvedValue({ ...intent, latest_charge: { ...intent.latest_charge,
        amount_refunded: reason === 'refunded' ? 100 : 0, disputed: reason === 'disputed' } });
    }
    expect((await delivery('invoice.paid')).status).toBe(200); expect(await payments()).toHaveLength(0); expect(await grants()).toHaveLength(0);
  });
  it('rejects cross-business checkout ownership and test/live mismatches', async () => {
    sdk.checkout.sessions.retrieve.mockResolvedValue({ ...session(), client_reference_id: TWO });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await delivery('checkout.session.completed')).status).toBe(500); expect(await grants()).toHaveLength(0);
    expect((await delivery('invoice.paid', 'live', { livemode: true })).status).toBe(400);
    expect(await asTenant(TWO, tx => tx`select * from billing_payment`)).toHaveLength(0);
  });
});
