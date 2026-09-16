import { describe, expect, it } from 'vitest';
import { stripeSandboxEnabled, stripeLiveEnabled, stripeCheckoutEnabled, stripeWebhookEnabled, LIVE_STRIPE_ACCOUNT, LIVE_LAUNCH_CATALOG, verifyStripeSignature } from '../src/stripe';
import { testEnv } from './harness';

const SECRET = 'whsec_test_secret';

describe('explicit live release isolation', () => {
  const live = () => testEnv({ STRIPE_BILLING_LIVE_ENABLED: 'true', STRIPE_SECRET_KEY: ['rk', 'live', 'fixture'].join('_'),
    STRIPE_CHECKOUT_ENABLED: 'true',
    STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_EXPECTED_ACCOUNT_ID: LIVE_STRIPE_ACCOUNT,
    STRIPE_LAUNCH_PRODUCT: LIVE_LAUNCH_CATALOG.product, STRIPE_LAUNCH_MONTHLY_PRICE: LIVE_LAUNCH_CATALOG.price,
    STRIPE_LAUNCH_COUPON: LIVE_LAUNCH_CATALOG.coupon, APP_ORIGIN: 'https://jentera.ai', API_ORIGIN: 'https://api.jentera.ai',
    HYPERDRIVE: { connectionString: 'postgres://fixture:fixture@reviewed-database.example/neondb' } });
  it('requires all explicit live boundaries, and never enables the sandbox too', () => {
    expect(stripeLiveEnabled(live())).toBe(true); expect(stripeSandboxEnabled(live())).toBe(false);
    expect(stripeCheckoutEnabled(live())).toBe(true);
  });
  it.each([
    { STRIPE_BILLING_LIVE_ENABLED: undefined }, { STRIPE_BILLING_SANDBOX_ENABLED: 'true' },
    { STRIPE_SECRET_KEY: 'rk_test_fixture' }, { STRIPE_EXPECTED_ACCOUNT_ID: 'acct_other' },
    { STRIPE_LAUNCH_MONTHLY_PRICE: 'price_other' }, { STRIPE_LAUNCH_COUPON: 'coupon_other' },
    { STRIPE_LAUNCH_PRODUCT: 'prod_other' }, { APP_ORIGIN: 'https://preview.example' },
    { API_ORIGIN: 'http://localhost:8787' }, { HYPERDRIVE: { connectionString: 'not-a-url' } },
    { HYPERDRIVE: { connectionString: 'postgres://fixture:fixture@localhost/neondb' } },
    { HYPERDRIVE: { connectionString: 'postgres://fixture:fixture@database.example/aisar_test' } },
  ])('fails closed for a mismatched boundary: %j', changes => {
    expect(stripeLiveEnabled(testEnv({ ...live(), ...changes }))).toBe(false);
  });
  it('does not open checkout until the webhook signing secret exists', () => {
    expect(stripeLiveEnabled(live())).toBe(true);
    expect(stripeCheckoutEnabled(testEnv({ ...live(), STRIPE_WEBHOOK_SECRET: undefined }))).toBe(false);
  });
  it('accepts the platform Hyperdrive gateway transport without mistaking its opaque name for the origin database', () => {
    const gateway = testEnv({ ...live(), HYPERDRIVE: {
      connectionString: 'postgres://gateway:fixture@0123456789abcdef0123456789abcdef.hyperdrive.local:5432/gateway',
      connect: () => { throw new Error('not invoked by the synchronous transport check'); },
    } });
    expect(stripeLiveEnabled(gateway)).toBe(true);
    expect(stripeSandboxEnabled(gateway)).toBe(false);
  });
  it('rejects a plain unbound gateway-looking URI with an unreviewed database name', () => {
    expect(stripeLiveEnabled(testEnv({ ...live(), HYPERDRIVE: {
      connectionString: 'postgres://gateway:fixture@0123456789abcdef0123456789abcdef.hyperdrive.local:5432/gateway',
    } }))).toBe(false);
  });
  it('can pause new purchases without stopping renewal and cancellation callbacks', () => {
    const paused = testEnv({ ...live(), STRIPE_CHECKOUT_ENABLED: 'false' });
    expect(stripeCheckoutEnabled(paused)).toBe(false); expect(stripeWebhookEnabled(paused)).toBe(true);
  });
});

describe('sandbox environment isolation', () => {
  const configured = () => testEnv({ STRIPE_BILLING_SANDBOX_ENABLED: 'true', STRIPE_SECRET_KEY: 'rk_test_fixture' });
  it('allows explicitly enabled billing only against isolated local Postgres/API', () => {
    expect(stripeSandboxEnabled(configured())).toBe(true);
  });
  it.each(['postgres://user:password@database.example/test', 'postgres://user:password@hyperdrive.local/neondb', 'postgres://user:password@127.0.0.1/neondb'])('rejects remote/production database %s', connectionString => {
    expect(stripeSandboxEnabled(testEnv({ ...configured(), HYPERDRIVE: { connectionString } }))).toBe(false);
  });
  it('rejects the production API even with a test key and local database', () => {
    expect(stripeSandboxEnabled(testEnv({ ...configured(), API_ORIGIN: 'https://api.jentera.ai' }))).toBe(false);
  });
  it('fails closed when database configuration is malformed', () => {
    expect(stripeSandboxEnabled(testEnv({ ...configured(), HYPERDRIVE: { connectionString: 'not-a-url' } }))).toBe(false);
  });
});

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(secret: string, payload: string, ts = Math.floor(Date.now() / 1000)): Promise<string> {
  const sig = await hmacHex(secret, `${ts}.${payload}`);
  return `t=${ts},v1=${sig}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a valid signature', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const signature = await sign(SECRET, payload);
    expect(await verifyStripeSignature(payload, signature, SECRET)).toBe(true);
  });

  it('accepts any valid v1 signature during rotation, regardless of order', async () => {
    const payload = '{"id":"evt_rotation"}';
    const good = await sign(SECRET, payload), bad = '0'.repeat(64);
    expect(await verifyStripeSignature(payload, `${good},v1=${bad}`, SECRET)).toBe(true);
    expect(await verifyStripeSignature(payload, good.replace(',v1=', `,v1=${bad},v1=`), SECRET)).toBe(true);
  });

  it('rejects a signed timestamp too far in the future', async () => {
    const payload = '{"id":"evt_future"}';
    expect(await verifyStripeSignature(payload, await sign(SECRET, payload, Math.floor(Date.now() / 1000) + 1000), SECRET)).toBe(false);
  });

  it('rejects multiple or non-integer timestamps', async () => {
    const signature = await sign(SECRET, '{}');
    expect(await verifyStripeSignature('{}', `${signature},t=1`, SECRET)).toBe(false);
    expect(await verifyStripeSignature('{}', 't=1.5,v1=bad', SECRET)).toBe(false);
  });

  it('rejects a tampered payload', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const signature = await sign(SECRET, payload);
    expect(await verifyStripeSignature(`${payload}x`, signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const signature = await sign(SECRET, payload);
    expect(await verifyStripeSignature(payload, signature, 'whsec_wrong')).toBe(false);
  });

  it('rejects a timestamp outside tolerance', async () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const signature = await sign(SECRET, payload, Math.floor(Date.now() / 1000) - 1000);
    expect(await verifyStripeSignature(payload, signature, SECRET)).toBe(false);
  });

  it('rejects a missing signature header', async () => {
    expect(await verifyStripeSignature('{}', null, SECRET)).toBe(false);
  });

  it('rejects a malformed header', async () => {
    expect(await verifyStripeSignature('{}', 'garbage', SECRET)).toBe(false);
  });
});
