/* ============================================================
   Stripe client and webhook signature verification.

   Raw fetch, not stripe-node: this integration touches three
   endpoints (checkout sessions, billing-portal sessions, and
   subscription reads), and a Worker's fetch handles all of them
   without pulling in an SDK's worth of unused surface. The API key
   and webhook secret are Worker secrets, never vars or source.

   Security rules followed (stripe-best-practices):
   - `payment_method_types` is never set (dynamic payment methods).
   - The webhook signature is verified before any event is trusted.
   - Keys are read from `env`, not embedded anywhere.
   ============================================================ */

import type { Env } from './env';

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_VERSION = '2026-08-26.dahlia';

export class StripeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'StripeError';
  }
}

/** Encode a flat params record as an x-www-form-urlencoded body. Keys may
    already carry brackets (e.g. `line_items[0][price]`); only the values are
    percent-encoded, which is the shape Stripe's form parser expects. */
function formEncode(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
}

async function stripeRequest(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<Record<string, unknown>> {
  const url = method === 'GET' && Object.keys(params).length
    ? `${STRIPE_API}${path}?${formEncode(params)}`
    : `${STRIPE_API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_VERSION,
  };
  const init: RequestInit = { method, headers };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = formEncode(params);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error?: { message?: string } }).error?.message ?? text)
      : text || `Stripe HTTP ${res.status}`;
    throw new StripeError(res.status, message);
  }
  return body ?? {};
}

/** POST /v1/checkout/sessions. `params` keys are pre-flattened by the caller
    (line_items[0][price], automatic_tax[enabled], …). */
export function createCheckoutSession(
  env: Env,
  params: Record<string, string | undefined>,
): Promise<Record<string, unknown>> {
  return stripeRequest(requireKey(env), 'POST', '/checkout/sessions', params);
}

/** POST /v1/billing_portal/sessions. */
export function createPortalSession(
  env: Env,
  params: Record<string, string | undefined>,
): Promise<Record<string, unknown>> {
  return stripeRequest(requireKey(env), 'POST', '/billing_portal/sessions', params);
}

/** GET /v1/subscriptions/:id with items' prices expanded, so the webhook can
    read the price id without a second call. */
export async function fetchSubscription(env: Env, id: string): Promise<Record<string, unknown>> {
  return stripeRequest(requireKey(env), 'GET', `/subscriptions/${id}`, {
    'expand[]': 'items.data.price',
  });
}

function requireKey(env: Env): string {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return env.STRIPE_SECRET_KEY;
}

/* ---------------------------------------------------------------- webhook */

/** Verify a Stripe-Signature header (t=…,v1=…) against the raw payload body.
    Constant-time comparison of the HMAC-SHA256 over `${timestamp}.${payload}`.
    Returns false on any malformed input, timestamp outside tolerance, or
    mismatch — the caller answers 400 and drops the event. */
export async function verifyStripeSignature(
  payload: string,
  signature: string | null,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signature) return false;
  const parts: Record<string, string> = {};
  for (const pair of signature.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    parts[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const signedPayload = `${ts}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload)),
  );
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, v1);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
