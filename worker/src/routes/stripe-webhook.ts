/* ============================================================
   Stripe webhook.

   POST /api/webhooks/stripe

   The second endpoint in this Worker called by someone other than our
   own frontend (the first is the Telegram webhook). It has no session,
   so its only defence is the signed header Stripe attaches to every
   delivery — verified against the raw body before anything is trusted.

   Idempotency: Stripe redelivers an event until it sees a 2xx. Each
   handled event is claimed in `stripe_event` (primary key = event id)
   before processing; a replay finds the claim and is dropped, and a
   failed process releases the claim so the retry can run it again.

   Ownership boundary: Stripe's first-class objects map to the business.
   `checkout.session.completed` carries `client_reference_id` (the
   business id we set at creation); subscription and invoice events carry
   a `customer` (cus_…), resolved through the security-definer helper.
   ============================================================ */

import type { Env } from '../env';
import { withTenant, withUser } from '../db';
import { fetchSubscription, verifyStripeSignature } from '../stripe';
import type { BusinessPlan } from '../agent-runtime';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface SubscriptionState {
  /** null leaves the current plan untouched (unknown price id). */
  plan: BusinessPlan | null;
  status: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  currentPeriodEnd: Date | null;
}

function planForPrice(env: Env, priceId: string | null): BusinessPlan | null {
  if (!priceId) return null;
  if ([env.STRIPE_PRICE_PRO_MONTHLY, env.STRIPE_PRICE_PRO_ANNUAL].includes(priceId)) return 'pro';
  if ([env.STRIPE_PRICE_TEAM_MONTHLY, env.STRIPE_PRICE_TEAM_ANNUAL].includes(priceId)) return 'team';
  return null;
}

async function writeSubscriptionState(env: Env, businessId: string, state: SubscriptionState): Promise<void> {
  await withTenant(env, businessId, async (tx) => {
    await tx`update business set
      plan = coalesce(${state.plan}, plan),
      stripe_customer_id = coalesce(${state.customerId}, stripe_customer_id),
      stripe_subscription_id = ${state.subscriptionId},
      stripe_subscription_status = ${state.status},
      stripe_current_period_end = ${state.currentPeriodEnd}
      where id = ${businessId}`;
  });
}

async function resolveBusinessForCustomer(env: Env, customer: string): Promise<string | null> {
  return withUser(env, async (sql) => {
    const [row] = await sql<{ id: string | null }[]>`
      select public.business_id_for_stripe_customer(${customer}) as id`;
    return row?.id ?? null;
  });
}

/** Read the plan + period from a subscription, expanding its first item's
    price so the plan can be resolved without a second Stripe call. */
async function stateForSubscription(env: Env, subscriptionId: string): Promise<{
  plan: BusinessPlan | null;
  status: string;
  currentPeriodEnd: Date | null;
}> {
  const sub = await fetchSubscription(env, subscriptionId);
  const items = (sub.items as { data?: Array<{ price?: { id: string } }> } | undefined)?.data;
  const priceId = items?.[0]?.price?.id ?? null;
  const period = typeof sub.current_period_end === 'number' ? sub.current_period_end : null;
  return {
    plan: planForPrice(env, priceId),
    status: String(sub.status ?? ''),
    currentPeriodEnd: period ? new Date(period * 1000) : null,
  };
}

async function handleCheckoutCompleted(env: Env, object: Record<string, unknown>): Promise<void> {
  const businessId = typeof object.client_reference_id === 'string' ? object.client_reference_id : null;
  if (!businessId || !UUID.test(businessId)) {
    console.warn('[stripe-webhook] checkout completed without a valid client_reference_id');
    return;
  }
  const customerId = typeof object.customer === 'string' ? object.customer : null;
  const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null;

  let plan: BusinessPlan | null = null;
  let status: string | null = null;
  let currentPeriodEnd: Date | null = null;
  if (subscriptionId) {
    const st = await stateForSubscription(env, subscriptionId);
    plan = st.plan;
    status = st.status;
    currentPeriodEnd = st.currentPeriodEnd;
    if (st.plan === null) console.warn('[stripe-webhook] unknown price id on checkout', subscriptionId);
  }

  await writeSubscriptionState(env, businessId, {
    plan,
    status,
    customerId,
    subscriptionId,
    currentPeriodEnd,
  });
}

async function handleSubscriptionUpdated(env: Env, object: Record<string, unknown>): Promise<void> {
  const customer = typeof object.customer === 'string' ? object.customer : null;
  const subscriptionId = typeof object.id === 'string' ? object.id : null;
  if (!customer || !subscriptionId) return;
  const businessId = await resolveBusinessForCustomer(env, customer);
  if (!businessId) return;

  const st = await stateForSubscription(env, subscriptionId);
  await writeSubscriptionState(env, businessId, {
    plan: st.plan,
    status: st.status,
    customerId: customer,
    subscriptionId,
    currentPeriodEnd: st.currentPeriodEnd,
  });
}

async function handleSubscriptionDeleted(env: Env, object: Record<string, unknown>): Promise<void> {
  const customer = typeof object.customer === 'string' ? object.customer : null;
  if (!customer) return;
  const businessId = await resolveBusinessForCustomer(env, customer);
  if (!businessId) return;

  await writeSubscriptionState(env, businessId, {
    plan: 'free',
    status: 'canceled',
    customerId: customer,
    subscriptionId: null,
    currentPeriodEnd: null,
  });
}

async function handleInvoiceStatus(env: Env, object: Record<string, unknown>, status: string): Promise<void> {
  const customer = typeof object.customer === 'string' ? object.customer : null;
  if (!customer) return;
  const businessId = await resolveBusinessForCustomer(env, customer);
  if (!businessId) return;

  /* A failed invoice leaves the plan alone but records the dunning state;
     a paid invoice recovers it. The subscription's own events remain the
     authority on plan and period. */
  await writeSubscriptionState(env, businessId, {
    plan: null,
    status,
    customerId: customer,
    subscriptionId: null,
    currentPeriodEnd: null,
  });
}

async function processStripeEvent(env: Env, event: StripeEvent): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(env, event.data.object);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(env, event.data.object);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(env, event.data.object);
    case 'invoice.paid':
      return handleInvoiceStatus(env, event.data.object, 'active');
    case 'invoice.payment_failed':
      return handleInvoiceStatus(env, event.data.object, 'past_due');
    default:
      return; // unknown event — acked, no state change
  }
}

export async function handleStripeWebhook(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== '/api/webhooks/stripe' || request.method !== 'POST') return null;

  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response('webhook not configured', { status: 503 });

  const signature = request.headers.get('Stripe-Signature');
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, signature, secret))) {
    return new Response('invalid signature', { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const claimed = await withUser(env, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      insert into stripe_event (id, type) values (${event.id}, ${event.type})
      on conflict (id) do nothing returning id`;
    return rows.length > 0;
  });
  if (!claimed) return new Response('ok', { status: 200 });

  try {
    await processStripeEvent(env, event);
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[stripe-webhook]', event.type, String(err));
    await withUser(env, async (sql) => sql`delete from stripe_event where id = ${event.id}`);
    return new Response('processing failed', { status: 500 });
  }
}
