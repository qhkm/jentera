/* ============================================================
   Billing: checkout and the customer portal.

   POST /api/billing/checkout   create a Checkout Session (owner)
   POST /api/billing/portal     create a Customer Portal session (owner)
   GET  /api/billing/status     the business's plan + Stripe state (member)

   The plan is bought, not declared: a business on 'free' opens Checkout
   and is upgraded by the webhook when the subscription becomes active,
   never by this route. Price ids are Worker vars, so the MYR amounts
   live in the Stripe Dashboard and change without a code deploy.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { createCheckoutSession, createPortalSession } from '../stripe';
import type { BusinessPlan } from '../agent-runtime';

type BillingPlan = Exclude<BusinessPlan, 'free'>;
type Interval = 'month' | 'year';

const PLAN = /^(pro|team)$/;
const INTERVAL = /^(month|year)$/;

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

/** Cookie-authenticated writes: the same origin check the team and
    task-review routes make, so a cross-site form cannot buy a plan. */
function originAllowed(request: Request, cors: Record<string, string>): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === cors['Access-Control-Allow-Origin'];
}

function priceIdFor(env: Env, plan: BillingPlan, interval: Interval): string | null {
  if (plan === 'pro') {
    return interval === 'month' ? env.STRIPE_PRICE_PRO_MONTHLY || null : env.STRIPE_PRICE_PRO_ANNUAL || null;
  }
  return interval === 'month' ? env.STRIPE_PRICE_TEAM_MONTHLY || null : env.STRIPE_PRICE_TEAM_ANNUAL || null;
}

/** 8 random letters, the suffix Stripe asks for on integration_identifier. */
function integrationLabel(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export async function handleBilling(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/billing')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'no business' }, { status: 401 }, cors);
  const { businessId } = identity;

  /* ---- status: any member --------------------------------------------- */
  if (url.pathname === '/api/billing/status' && request.method === 'GET') {
    const state = await withTenant(env, businessId, async (tx) => {
      const [row] = await tx<{
        plan: string;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        stripe_subscription_status: string | null;
        stripe_current_period_end: Date | null;
      }[]>`select plan, stripe_customer_id, stripe_subscription_id,
                stripe_subscription_status, stripe_current_period_end
           from business where id = ${businessId}`;
      return row ?? null;
    });
    if (!state) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    return json({
      ok: true,
      plan: state.plan,
      stripeCustomerId: state.stripe_customer_id,
      stripeSubscriptionStatus: state.stripe_subscription_status,
      currentPeriodEnd: state.stripe_current_period_end?.toISOString() ?? null,
    }, {}, { ...cors, 'Cache-Control': 'private, no-store' });
  }

  /* ---- checkout + portal are owner actions ---------------------------- */
  if (!can(identity, 'billing.manage')) {
    return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
  }
  if (!originAllowed(request, cors)) {
    return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
  }

  if (url.pathname === '/api/billing/checkout' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { plan?: unknown; interval?: unknown } | null;
    const plan = typeof body?.plan === 'string' && PLAN.test(body.plan) ? body.plan as BillingPlan : null;
    const interval = typeof body?.interval === 'string' && INTERVAL.test(body.interval) ? body.interval as Interval : 'month';
    if (!plan) return json({ ok: false, err: 'plan must be "pro" or "team"' }, { status: 400 }, cors);

    const priceId = priceIdFor(env, plan, interval);
    if (!priceId) return json({ ok: false, err: `no price configured for ${plan}/${interval}` }, { status: 503 }, cors);

    const customerId = await withTenant(env, businessId, async (tx) => {
      const [row] = await tx<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from business where id = ${businessId}`;
      return row?.stripe_customer_id ?? null;
    });

    const params: Record<string, string | undefined> = {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: businessId,
      success_url: `${env.APP_ORIGIN}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_ORIGIN}/billing`,
      integration_identifier: `jentera-${integrationLabel()}`,
    };
    if (customerId) {
      params.customer = customerId;
    } else {
      params.customer_email = identity.email;
    }
    if (env.STRIPE_AUTOMATIC_TAX === 'true') {
      params['automatic_tax[enabled]'] = 'true';
    }

    try {
      const session = await createCheckoutSession(env, params);
      return json({ ok: true, url: session.url }, {}, cors);
    } catch (err) {
      return json({ ok: false, err: (err as Error).message }, { status: 502 }, cors);
    }
  }

  if (url.pathname === '/api/billing/portal' && request.method === 'POST') {
    const customerId = await withTenant(env, businessId, async (tx) => {
      const [row] = await tx<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from business where id = ${businessId}`;
      return row?.stripe_customer_id ?? null;
    });
    if (!customerId) {
      return json({ ok: false, err: 'no Stripe customer for this business yet' }, { status: 409 }, cors);
    }
    try {
      const session = await createPortalSession(env, {
        customer: customerId,
        return_url: `${env.APP_ORIGIN}/billing`,
      });
      return json({ ok: true, url: session.url }, {}, cors);
    } catch (err) {
      return json({ ok: false, err: (err as Error).message }, { status: 502 }, cors);
    }
  }

  return null;
}
