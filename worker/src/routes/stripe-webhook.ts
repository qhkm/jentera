import type Stripe from 'stripe';
import type postgres from 'postgres';
import type { Env } from '../env';
import { withTenant, withUser } from '../db';
import { stripeClient, stripeWebhookEnabled, stripeIsLive, verifyStripeAccount, verifyStripeSignature } from '../stripe';

const TYPES = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed']);
function id(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : null;
}
function planForPrice(env: Env, price: string): 'pro' | 'team' | null {
  if (env.STRIPE_LAUNCH_MONTHLY_PRICE === price) return 'pro';
  if ([env.STRIPE_PRICE_PRO_MONTHLY, env.STRIPE_PRICE_PRO_ANNUAL].includes(price)) return 'pro';
  if ([env.STRIPE_PRICE_TEAM_MONTHLY, env.STRIPE_PRICE_TEAM_ANNUAL].includes(price)) return 'team';
  return null;
}
function date(seconds: number): Date {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 253402300799) throw new Error('invalid billing period');
  return new Date(seconds * 1000);
}

/** Invoice ownership follows Invoice -> Subscription -> server-created Checkout.
 * Customer identity alone is never sufficient proof for a paid entitlement. */
async function fulfillInvoice(tx: postgres.TransactionSql, env: Env, businessId: string, stripe: Stripe,
  subscription: Stripe.Subscription, price: string, payerUserId: string, invoiceId: string): Promise<void> {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (invoice.id !== invoiceId || invoice.livemode !== stripeIsLive(env) || invoice.currency !== 'myr' || invoice.status !== 'paid'
    || invoice.amount_paid <= 0 || invoice.amount_remaining !== 0
    || !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason ?? '')
    || invoice.parent?.type !== 'subscription_details'
    || id(invoice.parent.subscription_details?.subscription) !== subscription.id
    || id(invoice.customer) !== id(subscription.customer)) return;
  if (!Number.isSafeInteger(invoice.amount_paid)) throw new Error('invalid paid amount');
  const lines = invoice.lines;
  // Single licensed item is this foundation's supported catalog. More complex
  // invoices must not silently grant a whole period from a prorated amount.
  if (lines.has_more || lines.data.length !== 1) return;
  const line = lines.data[0];
  if (id(line.pricing?.price_details?.price) !== price || line.parent?.type !== 'subscription_item_details'
    || line.parent.subscription_item_details?.proration || line.amount <= 0 || line.quantity !== 1) return;
  const start = date(line.period.start), end = date(line.period.end);
  if (end <= start) throw new Error('invalid service period');
  // Reject zero-charge, externally marked-paid, pending, refunded and disputed
  // payments. PaymentIntent confirmation is independent of a redirect/webhook flag.
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: 'paid', limit: 100 });
  if (payments.has_more || payments.data.length !== 1) return;
  const payment = payments.data[0];
  const paymentIntentId = id(payment.payment.payment_intent);
  if (payment.livemode !== stripeIsLive(env) || id(payment.invoice) !== invoiceId || payment.currency !== 'myr'
    || payment.payment.type !== 'payment_intent' || !paymentIntentId || payment.amount_paid !== invoice.amount_paid) return;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const charge = intent.latest_charge;
  if (intent.id !== paymentIntentId || intent.livemode !== stripeIsLive(env) || intent.status !== 'succeeded' || intent.currency !== 'myr'
    || intent.amount_received !== invoice.amount_paid || id(intent.customer) !== id(subscription.customer)
    || !charge || typeof charge === 'string' || charge.livemode !== stripeIsLive(env)
    || id(charge.customer) !== id(subscription.customer) || id(charge.payment_intent) !== intent.id
    || charge.currency !== 'myr' || charge.amount !== invoice.amount_paid
    || charge.status !== 'succeeded' || !charge.paid || !charge.captured || charge.refunded || charge.amount_refunded !== 0 || charge.disputed) return;
  if (stripeIsLive(env) && (price !== env.STRIPE_LAUNCH_MONTHLY_PRICE
    || ![9900, 19900].includes(invoice.amount_paid) || invoice.amount_due !== invoice.amount_paid
    || invoice.total !== invoice.amount_paid || invoice.starting_balance !== 0 || invoice.ending_balance !== 0)) return;
  const [owner] = await tx`select u.email from membership m join app_user u on u.id=m.user_id
    where m.business_id=${businessId} and m.user_id=${payerUserId} and m.role='owner' and u.email_verified=true`;
  if (!owner) throw new Error('paid owner no longer eligible');
  const inserted = await tx`insert into billing_payment (invoice_id, business_id, subscription_id, customer_id, payment_intent_id,
    payer_user_id, amount_minor, currency, period_start, period_end)
    values (${invoiceId}, ${businessId}, ${subscription.id}, ${id(subscription.customer)!}, ${paymentIntentId}, ${payerUserId}, ${invoice.amount_paid}, 'myr', ${start}, ${end})
    on conflict (invoice_id) do nothing returning invoice_id`;
  // Invoice ID, not event ID, deduplicates paid callbacks and checkout fulfillment.
  if (!inserted.length) return;
  await tx`update business set stripe_paid_through=greatest(stripe_paid_through, ${end}) where id=${businessId}`;
  if (end > new Date()) {
    await tx`insert into billing_appreciation_outbox (business_id, payer_user_id, invoice_id)
      values (${businessId}, ${payerUserId}, ${invoiceId}) on conflict (business_id) do nothing`;
  }
}

/** Reconcile persisted proof, never an active/trial status or success URL alone. */
async function syncPaidAccess(tx: postgres.TransactionSql, businessId: string, subscription: Stripe.Subscription, plan: 'pro' | 'team'): Promise<void> {
  const [business] = await tx`select stripe_billing_review from business where id=${businessId}`;
  const [payment] = await tx`select p.invoice_id, p.period_end, u.email from billing_payment p
    join membership m on m.business_id=p.business_id and m.user_id=p.payer_user_id and m.role='owner'
    join app_user u on u.id=p.payer_user_id and u.email_verified=true
    where p.business_id=${businessId} and p.subscription_id=${subscription.id}
      and p.period_start<=now() and p.period_end>now()
      and not exists(select 1 from billing_payment_adjustment a where a.invoice_id=p.invoice_id)
    order by p.period_end desc limit 1`;
  const covered = !!payment && !business?.stripe_billing_review && ['active', 'past_due'].includes(subscription.status);
  if (covered) {
    await tx`insert into platform_access (email, kind, expires_at, note)
      values (${String(payment.email).toLowerCase()}, 'paid', ${payment.period_end}, ${`stripe:${subscription.id}:${payment.invoice_id}`})
      on conflict (email) do update set kind='paid', expires_at=excluded.expires_at, note=excluded.note
      where platform_access.revoked_at is null and (platform_access.kind<>'paid'
        or platform_access.note like 'stripe:%' or platform_access.expires_at<=now())`;
  } else {
    await tx`update platform_access set expires_at=least(expires_at, now())
      where note like ${`stripe:${subscription.id}:%`} and revoked_at is null`;
  }
  await tx`update business set plan=${covered ? plan : 'free'} where id=${businessId}`;
}

async function applyAdjustment(tx: postgres.TransactionSql, businessId: string, stripe: Stripe, env: Env, event: Stripe.Event): Promise<void> {
  const object = event.data.object as unknown as Record<string, unknown>;
  const disputed = event.type.startsWith('charge.dispute.');
  const chargeId = disputed ? id((await stripe.disputes.retrieve(id(object)!)).charge) : id(object);
  if (!chargeId) throw new Error('charge unavailable');
  const charge = await stripe.charges.retrieve(chargeId);
  const [payment] = await tx`select invoice_id, customer_id from billing_payment
    where business_id=${businessId} and payment_intent_id=${id(charge.payment_intent) ?? ''}`;
  if (!payment || charge.livemode !== stripeIsLive(env) || id(charge.customer) !== payment.customer_id) throw new Error('adjustment ownership mismatch');
  if (!disputed && charge.amount_refunded <= 0) return;
  await tx`insert into billing_payment_adjustment (source_id, business_id, invoice_id, charge_id, kind)
    values (${id(object)!}, ${businessId}, ${payment.invoice_id}, ${charge.id}, ${disputed ? 'dispute' : 'refund'})
    on conflict (source_id) do nothing`;
  // Any refund/dispute pauses Stripe-owned access for review. Later renewal,
  // closed-dispute or reordered events must not silently remove this hold.
  await tx`update business set stripe_billing_review=true, plan='free' where id=${businessId}`;
  await tx`update platform_access set expires_at=least(expires_at, now())
    where note like ${`stripe:%`} and email in (select lower(u.email) from app_user u
      join membership m on m.user_id=u.id where m.business_id=${businessId} and m.role='owner')
      and revoked_at is null`;
}

async function applyEvent(tx: postgres.TransactionSql, env: Env, businessId: string, stripe: Stripe, event: Stripe.Event): Promise<void> {
  const [business] = await tx`select stripe_customer_id, stripe_subscription_id from business where id=${businessId} for update`;
  if (!business) throw new Error('billing business unavailable');
  if (event.type.startsWith('charge.')) return applyAdjustment(tx, businessId, stripe, env, event);
  const object = event.data.object as unknown as Record<string, unknown>;
  let subscriptionId: string | null = null;
  let checkout: Record<string, unknown> | undefined;
  let paidCheckout = false;
  if (event.type.startsWith('checkout.session.')) {
    [checkout] = await tx`select * from billing_checkout where business_id=${businessId} and stripe_session_id=${id(object)!}`;
    if (!checkout) throw new Error('checkout ownership not ready');
    const session = await stripe.checkout.sessions.retrieve(String(checkout.stripe_session_id));
    if (session.id !== checkout.stripe_session_id || session.livemode !== stripeIsLive(env) || session.mode !== 'subscription' || id(session.customer) !== business.stripe_customer_id
      || session.client_reference_id !== businessId) throw new Error('checkout ownership mismatch');
    subscriptionId = id(session.subscription);
    paidCheckout = session.payment_status === 'paid';
  } else if (event.type.startsWith('invoice.')) {
    const invoice = await stripe.invoices.retrieve(id(object)!);
    if (invoice.parent?.type !== 'subscription_details') return; // unrelated manual invoice
    subscriptionId = id(invoice.parent.subscription_details?.subscription);
  } else subscriptionId = id(object);
  if (!subscriptionId) return;
  // Fetch inside the business lock: out-of-order deliveries cannot overwrite
  // a newer snapshot fetched by another callback while it holds that same lock.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.id !== subscriptionId || subscription.livemode !== stripeIsLive(env) || id(subscription.customer) !== business.stripe_customer_id) throw new Error('subscription ownership mismatch');
  if (subscription.items.has_more || subscription.items.data.length !== 1) return;
  const item = subscription.items.data[0], price = item.price.id, plan = planForPrice(env, price);
  if (!plan || item.quantity !== 1 || item.price.currency !== 'myr') return;
  if (!checkout) {
    const checkouts = await tx`select * from billing_checkout where business_id=${businessId} and price_id=${price} and stripe_session_id is not null order by created_at desc`;
    for (const candidate of checkouts) {
      const session = await stripe.checkout.sessions.retrieve(String(candidate.stripe_session_id));
      if (session.livemode === stripeIsLive(env) && id(session.subscription) === subscriptionId && id(session.customer) === business.stripe_customer_id
        && session.client_reference_id === businessId) { checkout = candidate; break; }
    }
  }
  if (!checkout || checkout.price_id !== price) throw new Error('subscription is not bound to a server-created checkout');
  if (business.stripe_subscription_id && business.stripe_subscription_id !== subscriptionId) {
    const existing = await stripe.subscriptions.retrieve(String(business.stripe_subscription_id));
    if (existing.livemode !== stripeIsLive(env) || id(existing.customer) !== business.stripe_customer_id) throw new Error('existing subscription ownership mismatch');
    if (!['canceled', 'incomplete_expired'].includes(existing.status)) return;
  }
  await tx`update business set stripe_subscription_id=${subscription.id}, stripe_subscription_status=${subscription.status},
    stripe_current_period_end=${date(item.current_period_end)} where id=${businessId}`;
  if (event.type === 'invoice.paid') await fulfillInvoice(tx, env, businessId, stripe, subscription, price, String(checkout.payer_user_id), id(object)!);
  else if (paidCheckout && id(subscription.latest_invoice)) await fulfillInvoice(tx, env, businessId, stripe, subscription, price, String(checkout.payer_user_id), id(subscription.latest_invoice)!);
  await syncPaidAccess(tx, businessId, subscription, plan);
}

export async function handleStripeWebhook(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/webhooks/stripe' || request.method !== 'POST') return null;
  const headers = { 'Cache-Control': 'no-store' };
  const response = (body: string, status: number) => new Response(body, { status, headers });
  if (!stripeWebhookEnabled(env)) return response('webhook not configured', 503);
  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > 128 * 1024) return response('payload too large', 413);
  if (!(await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET!))) return response('invalid signature', 400);
  let event: Stripe.Event;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed.id !== 'string' || !/^evt_[a-zA-Z0-9_]{1,180}$/.test(parsed.id) || typeof parsed.type !== 'string'
      || parsed.livemode !== stripeIsLive(env) || (parsed.api_version && parsed.api_version !== '2026-08-26.dahlia')
      || !parsed.data?.object || typeof parsed.data.object !== 'object' || Array.isArray(parsed.data.object)
      || !id(parsed.data.object)) return response('invalid event', 400);
    event = parsed;
  } catch { return response('invalid event', 400); }
  if (!TYPES.has(event.type)) return response('ok', 200);
  try {
    const object = event.data.object as unknown as Record<string, unknown>;
    const stripe = stripeClient(env);
    await verifyStripeAccount(env, stripe);
    let adjustmentIntent: string | null = null;
    if (event.type.startsWith('charge.')) {
      const chargeId = event.type.startsWith('charge.dispute.') ? id((await stripe.disputes.retrieve(id(object)!)).charge) : id(object);
      if (!chargeId) return response('invalid charge', 400);
      const charge = await stripe.charges.retrieve(chargeId);
      if (charge.livemode !== stripeIsLive(env)) return response('invalid charge mode', 400);
      adjustmentIntent = id(charge.payment_intent);
    }
    const businessId = await withUser(env, async sql => {
      const [row] = event.type.startsWith('charge.')
        ? await sql`select public.billing_business_for_payment_intent(${adjustmentIntent ?? ''}) as id`
        : event.type.startsWith('checkout.session.')
        ? await sql`select public.billing_business_for_checkout(${id(object)!}) as id`
        : await sql`select public.business_id_for_stripe_customer(${id(object.customer) ?? ''}) as id`;
      return row?.id as string | null;
    });
    if (!businessId) return response('ownership not ready; retry', 503);
    await withTenant(env, businessId, async tx => {
      // Claim and every side effect commit together. A crash/exception rolls both
      // back; a duplicate only sees a committed, fully processed event.
      const inserted = await tx`insert into stripe_event (id, type, business_id) values (${event.id}, ${event.type}, ${businessId}) on conflict (id) do nothing returning id`;
      if (!inserted.length) return;
      await applyEvent(tx, env, businessId, stripe, event);
    });
    return response('ok', 200);
  } catch {
    console.error('[stripe-webhook] processing failed; retry required');
    return response('processing failed', 500);
  }
}
