import type { Env } from '../env';
import { withTenant, withUser } from '../db';
import { hasBusiness, resolveBillingTenant } from '../tenancy';
import { can } from '../permissions';
import { stripeClient, stripeBillingEnabled, stripeCheckoutEnabled, stripeIsLive, verifyStripeAccount } from '../stripe';
import { verifiedLaunchCatalog } from '../billing/launch-catalog';
import { ensureBillingOwner } from '../billing/owner';
import { accessForEmail } from '../access';
import { chatPreviewEnabled } from '../chat-preview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function json(body: unknown, status: number, cors: Record<string, string>) {
  return Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'private, no-store' } });
}

export async function handleBilling(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  if (!['/api/billing/status', '/api/billing/checkout', '/api/billing/launch/checkout', '/api/billing/portal'].includes(url.pathname)) return null;
  if (request.method !== (url.pathname.endsWith('/status') ? 'GET' : 'POST')) return json({ ok: false, err: 'method not allowed' }, 405, cors);
  let identity = await resolveBillingTenant(env, request);
  if (!identity) return json({ ok: false, err: 'unauthorized' }, 401, cors);
  const [user] = await withUser(env, sql => sql`select email_verified from app_user where id=${identity!.userId}`);
  if (!user?.email_verified) return json({ ok: false, err: 'verified account required' }, 401, cors);
  const launch = url.pathname === '/api/billing/launch/checkout';
  if (!hasBusiness(identity) && !launch && request.method !== 'GET') return json({ ok: false, err: 'billing requires a business' }, 409, cors);
  if (hasBusiness(identity) && !can(identity, 'billing.manage')) return json({ ok: false, err: 'owner access required' }, 403, cors);
  if (request.method === 'GET') {
    const enabled = stripeBillingEnabled(env);
    try {
      const [history] = enabled ? await withUser(env, sql => sql`select public.billing_payer_has_payment(${identity!.userId}) as paid_before`) : [];
      const state = enabled && hasBusiness(identity) ? await withTenant(env, identity.businessId, async tx => {
        const [row] = await tx`select plan, stripe_subscription_status, stripe_current_period_end, stripe_paid_through,
          stripe_billing_review as review_required, stripe_customer_id is not null as has_customer,
          exists(select 1 from billing_payment p join platform_access a on a.email=${identity!.email.toLowerCase()}
            where p.business_id=business.id and p.payer_user_id=${identity!.userId}
            and p.subscription_id=business.stripe_subscription_id and p.period_end>now()
            and a.kind='paid' and a.revoked_at is null and a.expires_at>now()
            and a.note like ('stripe:' || p.subscription_id || ':%')) as paid_access_active
          from business where id=${identity!.businessId!}`;
        return row ?? null;
      }) : null;
      return json({ ok: true, signedIn: true, sandboxOnly: !stripeIsLive(env),
        ...(chatPreviewEnabled(env) ? { preview: (await accessForEmail(env, identity.email)).preview ?? null } : {}),
        mode: enabled ? stripeIsLive(env) ? 'live' : 'sandbox' : null,
        checkoutEnabled: stripeCheckoutEnabled(env), portalEnabled: enabled, creditEnforcementEnabled: false,
        offer: { initialMonthlyAmount: history?.paid_before === true ? 199 : 99, introductoryMonths: history?.paid_before === true ? 0 : 3, renewalMonthlyAmount: 199, currency: 'MYR' },
        activation: state?.review_required ? 'review' : state?.paid_access_active ? 'active' : state?.stripe_subscription_status ? 'pending' : 'inactive', state }, 200, cors);
    } catch {
      console.error('[billing] status unavailable');
      return json({ ok: false, err: 'Could not check billing. Please try again.' }, 503, cors);
    }
  }
  if (!request.headers.get('Origin') || request.headers.get('Origin') !== cors['Access-Control-Allow-Origin']) return json({ ok: false, err: 'origin not allowed' }, 403, cors);
  if (url.pathname.endsWith('/portal') ? !stripeBillingEnabled(env) : !stripeCheckoutEnabled(env)) return json({ ok: false, err: 'checkout is not configured yet' }, 503, cors);
  if (stripeIsLive(env) && url.pathname === '/api/billing/checkout') return json({ ok: false, err: 'only the launch plan is available' }, 403, cors);
  // Tax intentionally not enabled. Registration and launch tax treatment need review.
  if (!url.pathname.endsWith('/portal') && env.STRIPE_AUTOMATIC_TAX === 'true') return json({ ok: false, err: 'tax configuration has not passed the launch review' }, 503, cors);
  const stripe = stripeClient(env);
  try {
    await verifyStripeAccount(env, stripe);
    const launchBody = launch ? await request.json().catch(() => null) as { plan?: unknown; interval?: unknown } | null : null;
    if (launch && (launchBody?.plan !== 'launch' || Object.keys(launchBody).some(key => key !== 'plan'))) return json({ ok: false, err: 'invalid launch checkout request' }, 400, cors);
    if (launch && !hasBusiness(identity)) {
      // Invalid requests cannot create a placeholder business or provider object.
      if (!UUID.test(request.headers.get('Idempotency-Key') ?? '')) return json({ ok: false, err: 'a UUID Idempotency-Key is required' }, 400, cors);
      if (!env.STRIPE_LAUNCH_MONTHLY_PRICE || !env.STRIPE_LAUNCH_PRODUCT || !env.STRIPE_LAUNCH_COUPON) return json({ ok: false, err: 'launch checkout configuration is missing' }, 503, cors);
      identity = await ensureBillingOwner(env, identity);
      if (!identity) return json({ ok: false, err: 'verified owner required' }, 403, cors);
    }
    if (!hasBusiness(identity)) return json({ ok: false, err: 'verified owner required' }, 403, cors);
    const { businessId } = identity;
    const billingIdentity = identity;
    if (url.pathname.endsWith('/portal')) {
      const customer = await withTenant(env, businessId, async tx => {
        const [row] = await tx`select stripe_customer_id from business where id=${businessId}`;
        return row?.stripe_customer_id as string | null;
      });
      if (!customer) return json({ ok: false, err: 'no billing account yet' }, 409, cors);
      const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${env.APP_ORIGIN}/app?view=business` });
      const portalUrl = new URL(session.url);
      if (portalUrl.protocol !== 'https:' || portalUrl.hostname !== 'billing.stripe.com' || portalUrl.username || portalUrl.password) throw new Error('invalid portal response');
      return json({ ok: true, url: session.url }, 200, cors);
    }
    const body = launch ? launchBody : await request.json().catch(() => null) as { plan?: unknown; interval?: unknown } | null;
    const plan = launch ? 'pro' : body?.plan;
    const interval = launch ? 'month' : body?.interval ?? 'month';
    if ((plan !== 'pro' && plan !== 'team') || (interval !== 'month' && interval !== 'year')) return json({ ok: false, err: 'invalid plan or billing interval' }, 400, cors);
    const price = launch ? env.STRIPE_LAUNCH_MONTHLY_PRICE : plan === 'pro'
      ? (interval === 'month' ? env.STRIPE_PRICE_PRO_MONTHLY : env.STRIPE_PRICE_PRO_ANNUAL)
      : (interval === 'month' ? env.STRIPE_PRICE_TEAM_MONTHLY : env.STRIPE_PRICE_TEAM_ANNUAL);
    if (!price) return json({ ok: false, err: 'price not configured' }, 503, cors);
    const key = request.headers.get('Idempotency-Key') ?? '';
    if (!UUID.test(key)) return json({ ok: false, err: 'a UUID Idempotency-Key is required' }, 400, cors);
    const outcome = await withTenant(env, businessId, async tx => {
      // Serializes double-taps, distinct concurrent requests and webhook fulfillment.
      // Provider requests are bounded by the SDK's timeout and stable idempotency keys.
      const [business] = await tx`select stripe_customer_id, stripe_subscription_id, stripe_billing_review from business where id=${businessId} for update`;
      if (business?.stripe_billing_review) return { error: 'billing review required; contact support before subscribing again', status: 403 };
      const [access] = await tx`select revoked_at from platform_access where email=${billingIdentity.email.toLowerCase()}`;
      if (access?.revoked_at) return { error: 'account review required; checkout is unavailable', status: 403 };
      const [payer] = await tx`select u.id from membership m join app_user u on u.id=m.user_id
        where m.business_id=${businessId} and m.user_id=${billingIdentity.userId} and m.role='owner' and u.email_verified=true`;
      if (!payer) return { error: 'verified owner required', status: 403 };
      const [prior] = await tx`select * from billing_checkout where id=${key}`;
      if (prior && (prior.price_id !== price || prior.business_id !== businessId || prior.payer_user_id !== billingIdentity.userId)) return { error: 'idempotency key conflicts with another request', status: 409 };
      if (business?.stripe_subscription_id) {
        const existing = await stripe.subscriptions.retrieve(String(business.stripe_subscription_id));
        if (existing.livemode !== stripeIsLive(env) || existing.customer !== business.stripe_customer_id) throw new Error('subscription ownership mismatch');
        if (!['canceled', 'incomplete_expired'].includes(existing.status)) return { error: 'manage the existing subscription in the billing portal', status: 409 };
      }
      const [pending] = await tx`select price_id, url from billing_checkout where business_id=${businessId} and expires_at>now() and url is not null order by created_at desc limit 1`;
      if (pending) return pending.price_id === price ? { url: pending.url } : { error: 'another checkout is already open', status: 409 };
      if (prior?.stripe_session_id) return { error: 'checkout expired; use a new request key', status: 409 };
      const [history] = launch ? await tx`select public.billing_payer_has_payment(${billingIdentity.userId})
        or exists(select 1 from billing_payment where business_id=${businessId}) as paid_before` : [];
      const catalog = launch ? await verifiedLaunchCatalog(env, stripe, history?.paid_before !== true) : null;
      const productPrice = catalog ? null : await stripe.prices.retrieve(price);
      if (productPrice && (!productPrice.active || productPrice.livemode !== stripeIsLive(env) || productPrice.currency !== 'myr' || productPrice.type !== 'recurring'
        || productPrice.recurring?.interval !== interval || productPrice.recurring?.interval_count !== 1
        || !Number.isSafeInteger(productPrice.unit_amount) || productPrice.unit_amount! <= 0)) return { error: 'price configuration is not valid', status: 503 };
      const customer = business?.stripe_customer_id as string | null
        ?? (await stripe.customers.create({ email: billingIdentity.email }, { idempotencyKey: `jentera-customer-${businessId}` })).id;
      await tx`update business set stripe_customer_id=${customer} where id=${businessId}`;
      const inserted = await tx`insert into billing_checkout (id, business_id, payer_user_id, price_id, plan, interval)
        values (${key}, ${businessId}, ${billingIdentity.userId}, ${price}, ${plan}, ${interval}) on conflict (id) do nothing returning id`;
      if (!inserted.length && !prior) return { error: 'request key is unavailable; use a new key', status: 409 };
      const suffix = key.replace(/-/g, '').slice(0, 8).split('').map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription', customer, client_reference_id: businessId,
        line_items: [{ price, quantity: 1 }],
        ...(catalog ? { discounts: catalog.discounts, consent_collection: { terms_of_service: 'required' as const },
          custom_text: { submit: { message: catalog.disclosure } }, adaptive_pricing: { enabled: false } } : {}),
        success_url: `${env.APP_ORIGIN}/subscribe?checkout=complete`,
        cancel_url: `${env.APP_ORIGIN}/subscribe?checkout=canceled`,
        integration_identifier: `jentera-${suffix}`,
      }, { idempotencyKey: `jentera-checkout-${businessId}-${key}` });
      if (!session.url || session.livemode !== stripeIsLive(env) || !session.expires_at) throw new Error('invalid checkout response');
      const checkoutUrl = new URL(session.url);
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com' || checkoutUrl.username || checkoutUrl.password) throw new Error('invalid checkout response');
      await tx`update billing_checkout set stripe_session_id=${session.id}, url=${session.url}, expires_at=${new Date(session.expires_at * 1000)} where id=${key} and business_id=${businessId}`;
      return { url: session.url };
    });
    return 'error' in outcome ? json({ ok: false, err: outcome.error }, outcome.status!, cors) : json({ ok: true, url: outcome.url }, 200, cors);
  } catch {
    // Stripe errors may contain billing addresses, payment details or credentials.
    console.error('[billing] provider operation failed');
    return json({ ok: false, err: 'billing is temporarily unavailable; please try again' }, 502, cors);
  }
}
