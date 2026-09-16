import Stripe from 'stripe';
import type { Env } from './env';
import { withUser } from './db';

/** Sandbox billing requires an isolated local database and test credential.
 * A sandbox flag alone can never enable production charging. */
export function stripeSandboxEnabled(env: Env): boolean {
  if (env.STRIPE_BILLING_LIVE_ENABLED === 'true') return false;
  if (env.STRIPE_BILLING_SANDBOX_ENABLED !== 'true' || !/^[sr]k_test_\S+$/.test(env.STRIPE_SECRET_KEY ?? '')) return false;
  try {
    // Sandbox receipts must never unlock the production database. This first
    // slice supports only isolated local Postgres, not a cloud/prod binding.
    const database = new URL(env.HYPERDRIVE.connectionString);
    const api = new URL(env.API_ORIGIN);
    return ['postgres:', 'postgresql:'].includes(database.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
      && database.pathname !== '/neondb'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname);
  } catch { return false; }
}

export const LIVE_STRIPE_ACCOUNT = 'acct_1UG90wHuvvz49fq3';
export const LIVE_LAUNCH_CATALOG = {
  product: 'prod_VGrzwJYyjyq39c', price: 'price_1UGKFDHuvvz49fq3tGmnpgky',
  coupon: 'jentera_launch_myr_100_off_3_months_v1',
} as const;

/** Hyperdrive's transport database name can be opaque. The authenticated
 * platform binding, not its per-request gateway URI, identifies the origin.
 * Actual database/role identity is checked asynchronously before provider use. */
export function stripeLiveDatabaseTransport(env: Env): boolean {
  try {
    const database = new URL(env.HYPERDRIVE.connectionString);
    const nativeGateway = /^[a-f0-9]{32}\.hyperdrive\.local$/.test(database.hostname)
      && typeof env.HYPERDRIVE.connect === 'function';
    return ['postgres:', 'postgresql:'].includes(database.protocol)
      && (database.pathname === '/neondb' || nativeGateway)
      && !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname);
  } catch { return false; }
}

export async function verifyStripeDatabase(env: Env): Promise<void> {
  const [identity] = await withUser(env, sql => sql`select current_database() as database_name, current_user as role_name`);
  if (identity?.database_name !== 'neondb' || identity?.role_name !== 'aisar_app') {
    throw new Error('Stripe database identity does not match the reviewed production database');
  }
}

/** Explicit production boundary. Sandbox receipts cannot activate production. */
export function stripeLiveEnabled(env: Env): boolean {
  if (env.STRIPE_BILLING_LIVE_ENABLED !== 'true' || env.STRIPE_BILLING_SANDBOX_ENABLED === 'true'
    || !/^rk_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? '')
    || env.STRIPE_EXPECTED_ACCOUNT_ID !== LIVE_STRIPE_ACCOUNT
    || env.APP_ORIGIN !== 'https://jentera.ai' || env.API_ORIGIN !== 'https://api.jentera.ai'
    || env.STRIPE_LAUNCH_PRODUCT !== LIVE_LAUNCH_CATALOG.product
    || env.STRIPE_LAUNCH_MONTHLY_PRICE !== LIVE_LAUNCH_CATALOG.price
    || env.STRIPE_LAUNCH_COUPON !== LIVE_LAUNCH_CATALOG.coupon) return false;
  return stripeLiveDatabaseTransport(env);
}

export const stripeBillingEnabled = (env: Env) => stripeSandboxEnabled(env) || stripeLiveEnabled(env);
export const stripeWebhookEnabled = (env: Env) => stripeBillingEnabled(env)
  && /^whsec_\S+$/.test(env.STRIPE_WEBHOOK_SECRET ?? '');
// Closing new purchases must not stop paid renewals, cancellation or callbacks.
export const stripeCheckoutEnabled = (env: Env) => stripeWebhookEnabled(env) && env.STRIPE_CHECKOUT_ENABLED === 'true';
export const stripeIsLive = (env: Env) => stripeLiveEnabled(env);

export async function verifyStripeAccount(env: Env, client: Stripe): Promise<void> {
  if (!stripeIsLive(env)) return;
  await verifyStripeDatabase(env);
  const account = await client.accounts.retrieve(null);
  if (account.id !== LIVE_STRIPE_ACCOUNT || account.country !== 'MY' || !account.charges_enabled) {
    throw new Error('Stripe seller configuration does not match the approved account');
  }
}

export function stripeClient(env: Env): Stripe {
  if (!stripeBillingEnabled(env)) throw new Error('Stripe billing is disabled');
  return new Stripe(env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-08-26.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10_000,
    maxNetworkRetries: 1,
  });
}

/** SDK verification accepts any valid v1 signature during secret rotation. */
export async function verifyStripeSignature(
  payload: string,
  signature: string | null,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const timestamps = signature.split(',').map(part => part.trim()).filter(part => part.startsWith('t='));
  if (timestamps.length !== 1 || !/^t=\d+$/.test(timestamps[0])) return false;
  const timestamp = Number(timestamps[0].slice(2));
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  try {
    if (!Stripe.webhooks.signature) return false;
    await Stripe.webhooks.signature.verifyHeaderAsync(
      payload, signature, secret, toleranceSeconds, Stripe.createSubtleCryptoProvider(),
    );
    return true;
  } catch {
    return false;
  }
}
