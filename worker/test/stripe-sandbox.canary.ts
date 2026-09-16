import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { asOwner, asTenant, signIn, testEnv, truncateAll } from './harness';
import { handleBilling } from '../src/routes/billing';
import { handleStripeWebhook } from '../src/routes/stripe-webhook';
import { handleAccess } from '../src/routes/access';
import { stripeClient, stripeSandboxEnabled } from '../src/stripe';
import type { Env } from '../src/env';
import type Stripe from 'stripe';

const run = promisify(execFile);
const cli = process.env.JENTERA_STRIPE_CANARY_CLI;
const profile = process.env.JENTERA_STRIPE_CANARY_CONFIG;
const account = process.env.JENTERA_STRIPE_CANARY_ACCOUNT;
const version = '2026-08-26.dahlia';
const types = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid',
  'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'];
// Not an API key. All SDK HTTP requests are delegated to the authenticated CLI;
// its real credential stays in its secure store, never source, argv or this test.
const transportToken = ['rk', 'test', 'local_cli_transport_not_a_credential'].join('_');
const receipts: { payload: string; signature: string; type: string; status: number }[] = [];
const providerErrors: string[] = [];
let env: Env, server: Server, listener: ChildProcess, sdk: Stripe;
let cookie: string, user: string, business: string, stage = 'setup';
const origin = 'http://127.0.0.1:5173';
const cors = { 'Access-Control-Allow-Origin': origin };
const nativeFetch = globalThis.fetch;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  do { const value = await read(); if (accepts(value)) return value; await pause(1000); } while (Date.now() < end);
  throw new Error(`Canary timed out at ${stage}`);
}
async function command(args: string[]) {
  if (!cli || !profile || !account || !cli.startsWith('/') || !profile.startsWith('/')
    || !/^acct_[A-Za-z0-9]+$/.test(account) || account === 'acct_1UG90wHuvvz49fq3') throw new Error('Explicit isolated sandbox configuration required');
  return run(cli, ['--config', profile, '--color', 'off', ...args], { timeout: 30_000, maxBuffer: 2_000_000 });
}
/** Real sandbox transport, not an SDK mock. No --live or API key arguments. */
async function cliFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return nativeFetch(input, init);
  if (url.origin !== 'https://api.stripe.com' || !/^\/v1\//.test(url.pathname)) throw new Error('Canary outbound target refused');
  const method = (init?.method ?? 'GET').toLowerCase();
  if (!['get', 'post', 'delete'].includes(method)) throw new Error('Canary method refused');
  const headers = new Headers(init?.headers);
  if (headers.get('authorization') !== `Bearer ${transportToken}`) throw new Error('Canary transport credential mismatch');
  const args = [method, url.pathname, '--stripe-version', version];
  for (const [key, value] of url.searchParams) args.push('--data', `${key}=${value}`);
  if (typeof init?.body === 'string') for (const [key, value] of new URLSearchParams(init.body)) args.push('--data', `${key}=${value}`);
  const idempotency = headers.get('idempotency-key');
  if (idempotency) args.push('--idempotency', idempotency);
  let stdout: string;
  try { stdout = (await command(args)).stdout; }
  catch (error) {
    const failed = error as { stdout?: string };
    const body = JSON.parse(failed.stdout ?? '{}');
    if (!body.error) throw new Error(`CLI sandbox transport failed at ${stage}`);
    providerErrors.push(`${body.error.type ?? 'error'}:${body.error.code ?? 'none'}:${body.error.message ?? 'provider rejected request'}`);
    return Response.json(body, { status: body.error.type === 'authentication_error' ? 401 : 400 });
  }
  const body = JSON.parse(stdout);
  if (body.error) providerErrors.push(`${body.error.type ?? 'error'}:${body.error.code ?? 'none'}:${body.error.message ?? 'provider rejected request'}`);
  if (body.livemode === true) throw new Error('Live response refused');
  return Response.json(body, { status: body.error ? 400 : 200 });
}
async function access() {
  const url = new URL(`${env.API_ORIGIN}/api/access`);
  return (await (await handleAccess(new Request(url, { headers: { Cookie: cookie } }), env, url, cors))!.json()) as {
    access: { allowed: boolean; kind: string }; founderGroup: { url: string } | null;
  };
}
async function checkout() {
  const url = new URL(`${env.API_ORIGIN}/api/billing/launch/checkout`);
  const request = new Request(url, { method: 'POST', headers: { Cookie: cookie, Origin: origin,
    'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ plan: 'launch' }) });
  const response = (await handleBilling(request, env, url, cors))!;
  expect(response.status).toBe(200);
  return (await response.json()) as { url: string };
}
beforeAll(async () => {
  const context = JSON.parse((await command(['whoami', '--format', 'json'])).stdout);
  if (context.account_id !== account || context.mode !== 'test') throw new Error('CLI must be authorized for the expected sandbox only');
  await truncateAll();
  env = testEnv({ ACCESS_MODE: 'waitlist', APP_ORIGIN: origin, ALLOWED_ORIGINS: origin,
    STRIPE_SECRET_KEY: transportToken, STRIPE_BILLING_SANDBOX_ENABLED: 'true', STRIPE_BILLING_LIVE_ENABLED: 'false',
    STRIPE_CHECKOUT_ENABLED: 'true', LAUNCH_FOUNDER_GROUP_URL: `https://chat.whatsapp.com/${'A'.repeat(22)}` });
  expect(stripeSandboxEnabled(env)).toBe(true);
  vi.stubGlobal('fetch', cliFetch); sdk = stripeClient(env);
  const seller = await sdk.accounts.retrieve(null);
  expect(seller.id).toBe(account);
  server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 128 * 1024) throw new Error('too large'); chunks.push(chunk); }
      const payload = Buffer.concat(chunks).toString('utf8');
      const signature = String(request.headers['stripe-signature'] ?? '');
      const url = new URL(`${env.API_ORIGIN}${request.url}`);
      const result = (await handleStripeWebhook(new Request(url, { method: 'POST', body: payload,
        headers: { 'Stripe-Signature': signature } }), env, url))!;
      receipts.push({ payload, signature, type: JSON.parse(payload).type, status: result.status });
      response.writeHead(result.status); response.end(await result.text());
    } catch { response.writeHead(500); response.end('canary failed'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('local listener unavailable');
  env.API_ORIGIN = `http://127.0.0.1:${address.port}`;
  listener = spawn(cli!, ['--config', profile!, 'listen', '--latest', '--skip-update', '--events', types.join(','),
    '--forward-to', `${env.API_ORIGIN}/api/webhooks/stripe`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8192);
    const secret = /whsec_[A-Za-z0-9]+/.exec(output)?.[0]; if (secret) env.STRIPE_WEBHOOK_SECRET = secret; };
  listener.stdout!.on('data', capture); listener.stderr!.on('data', capture);
  await until(async () => Boolean(env.STRIPE_WEBHOOK_SECRET), Boolean);
  const product = await sdk.products.create({ name: 'Jentera isolated launch canary', metadata: { jentera_canary: 'true' } });
  const price = await sdk.prices.create({ product: product.id, currency: 'myr', unit_amount: 19900,
    recurring: { interval: 'month', usage_type: 'licensed' } });
  const coupon = await sdk.coupons.create({ currency: 'myr', amount_off: 10000, duration: 'repeating', duration_in_months: 3,
    applies_to: { products: [product.id] } });
  env.STRIPE_LAUNCH_PRODUCT = product.id; env.STRIPE_LAUNCH_MONTHLY_PRICE = price.id; env.STRIPE_LAUNCH_COUPON = coupon.id;
  const [owner] = await asOwner(sql => sql`insert into app_user (email, email_verified)
    values (${'canary-' + crypto.randomUUID() + '@example.invalid'}, true) returning id`);
  user = owner.id; cookie = await signIn(user);
});
afterAll(async () => {
  listener?.kill('SIGTERM');
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllGlobals();
});
it('real sandbox renewal prices are RM99 × 3 then RM199, and a failed renewal never activates an unrelated owner', async () => {
  try {
    stage = 'real pricing test clock';
    const clock = await sdk.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: 'Jentera launch pricing canary' });
    const customer = await sdk.customers.create({ test_clock: clock.id, metadata: { jentera_canary: 'pricing-only' } });
    const card = await sdk.paymentMethods.attach('pm_card_visa', { customer: customer.id });
    const subscription = await sdk.subscriptions.create({ customer: customer.id, default_payment_method: card.id,
      items: [{ price: env.STRIPE_LAUNCH_MONTHLY_PRICE!, quantity: 1 }], discounts: [{ coupon: env.STRIPE_LAUNCH_COUPON! }],
      payment_behavior: 'error_if_incomplete' });
    const invoiceId = (value: Stripe.Subscription) => typeof value.latest_invoice === 'string' ? value.latest_invoice : value.latest_invoice!.id;
    let current = subscription;
    let invoice = await sdk.invoices.retrieve(invoiceId(current));
    expect(invoice.amount_paid).toBe(9900);
    const amounts = [invoice.amount_paid];
    console.log('PASS initial real pricing invoice: RM99');
    for (let month = 2; month <= 4; month++) {
      stage = `real renewal month ${month}`;
      const prior = invoice.id;
      await sdk.testHelpers.testClocks.advance(clock.id, { frozen_time: current.items.data[0].current_period_end + 7200 });
      await until(() => sdk.testHelpers.testClocks.retrieve(clock.id), value => value.status === 'ready');
      current = await sdk.subscriptions.retrieve(subscription.id);
      invoice = await until(async () => { current = await sdk.subscriptions.retrieve(subscription.id); return sdk.invoices.retrieve(invoiceId(current)); }, value => value.id !== prior && value.status === 'paid');
      expect(invoice.amount_paid).toBe(month <= 3 ? 9900 : 19900); amounts.push(invoice.amount_paid);
      console.log(`PASS real pricing renewal month ${month}: RM${invoice.amount_paid / 100}`);
    }
    stage = 'real renewal payment failure';
    const decline = await sdk.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: customer.id });
    await sdk.subscriptions.update(subscription.id, { default_payment_method: decline.id });
    const prior = invoice.id;
    await sdk.testHelpers.testClocks.advance(clock.id, { frozen_time: current.items.data[0].current_period_end + 7200 });
    await until(() => sdk.testHelpers.testClocks.retrieve(clock.id), value => value.status === 'ready');
    current = await sdk.subscriptions.retrieve(subscription.id);
    invoice = await until(async () => { current = await sdk.subscriptions.retrieve(subscription.id); return sdk.invoices.retrieve(invoiceId(current)); }, value => value.id !== prior && value.status !== 'draft');
    expect(invoice.amount_paid).toBe(0); expect(invoice.status).not.toBe('paid');
    expect((await access()).access.allowed).toBe(false);
    console.log(`PASS genuine Stripe test-clock invoices: ${amounts.join(',')} minor MYR; failed renewal paid=0; unrelated owner remains restricted`);
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'unknown failure') + ' ' + providerErrors.join(';');
    throw new Error(`${stage}: ${message.replace(/[sr]k_(?:live|test)_[A-Za-z0-9_]+/g, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 500)}`);
  }
});
it('real hosted sandbox checkout → signed activation → dedupe → cancel → refund hold', async () => {
  try {
    stage = 'create account-bound hosted checkout';
    const { url } = await checkout();
    const [membership] = await asOwner(sql => sql`select business_id from membership where user_id=${user}`); business = membership.business_id;
    const [saved] = await asTenant(business, tx => tx`select stripe_session_id from billing_checkout where business_id=${business}`);
    const initial = await sdk.checkout.sessions.retrieve(String(saved.stripe_session_id));
    expect(initial.livemode).toBe(false); expect(initial.amount_total).toBe(9900); expect(initial.consent_collection?.terms_of_service).toBe('required');
    expect((await access()).access.allowed).toBe(false);
    stage = 'complete fake-card payment in hosted sandbox checkout';
    const destination = new URL(url); expect(destination.hostname).toBe('checkout.stripe.com');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: 'Sandbox payment returned.' }));
      await page.goto(url); await page.getByLabel(/Card number/i).fill('4242424242424242');
      await page.getByLabel(/Expiration|Expiry/i).fill('1234'); await page.locator('input[autocomplete="cc-csc"]:visible').fill('123');
      const name = page.getByLabel(/Cardholder name|Name on card/i); if (await name.count()) await name.first().fill('Jentera Sandbox Canary');
      const postal = page.getByLabel(/ZIP|Postal/i); if (await postal.count()) await postal.first().fill('47301');
      await page.locator('#termsOfServiceConsentCheckbox').check();
      await page.getByRole('button', { name: /^(Subscribe|Pay|Start subscription)/i }).last().click();
      await until(() => sdk.checkout.sessions.retrieve(initial.id), value => value.payment_status === 'paid');
    } finally { await browser.close(); }
    stage = 'verify real signed delivery and paid-only entitlement';
    await until(access, value => value.access.allowed);
    expect((await access()).access.kind).toBe('paid'); expect((await access()).founderGroup).not.toBeNull();
    const payments = await asTenant(business, tx => tx`select invoice_id, amount_minor, payment_intent_id, subscription_id from billing_payment where business_id=${business}`);
    expect(payments).toHaveLength(1); expect(Number(payments[0].amount_minor)).toBe(9900);
    const receipt = await until(async () => receipts.find(value => value.type === 'checkout.session.completed' && value.status === 200), Boolean);
    expect(receipt).toBeDefined();
    stage = 'redeliver original signed callback';
    const endpoint = new URL(`${env.API_ORIGIN}/api/webhooks/stripe`);
    const duplicate = (await handleStripeWebhook(new Request(endpoint, { method: 'POST', body: receipt!.payload,
      headers: { 'Stripe-Signature': receipt!.signature } }), env, endpoint))!;
    expect(duplicate.status).toBe(200);
    expect(await asTenant(business, tx => tx`select invoice_id from billing_payment where business_id=${business}`)).toHaveLength(1);
    stage = 'real owner-bound renewal invoices';
    const clock = await sdk.testHelpers.testClocks.create({ customer: String(initial.customer),
      frozen_time: Math.floor(Date.now() / 1000) + 10, name: 'Jentera owned renewal canary' });
    await until(() => sdk.testHelpers.testClocks.retrieve(clock.id), value => value.status === 'ready');
    let subscription = await sdk.subscriptions.retrieve(String(payments[0].subscription_id));
    for (let month = 2; month <= 4; month++) {
      stage = `signed owner-bound renewal month ${month}`;
      await sdk.testHelpers.testClocks.advance(clock.id, { frozen_time: subscription.items.data[0].current_period_end + 7200 });
      await until(() => sdk.testHelpers.testClocks.retrieve(clock.id), value => value.status === 'ready');
      subscription = await sdk.subscriptions.retrieve(subscription.id);
      await until(() => asTenant(business, tx => tx`select amount_minor from billing_payment where business_id=${business}`), value => value.length === month);
    }
    const renewals = await asTenant(business, tx => tx`select amount_minor from billing_payment where business_id=${business} order by period_start`);
    expect(renewals.map(value => Number(value.amount_minor))).toEqual([9900, 9900, 9900, 19900]);
    const [coverage] = await asTenant(business, tx => tx`select stripe_paid_through from business where id=${business}`);
    stage = 'failed owner-bound renewal does not extend paid proof';
    const decline = await sdk.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: String(initial.customer) });
    await sdk.subscriptions.update(subscription.id, { default_payment_method: decline.id });
    const failuresBefore = receipts.filter(value => value.type === 'invoice.payment_failed' && value.status === 200).length;
    await sdk.testHelpers.testClocks.advance(clock.id, { frozen_time: subscription.items.data[0].current_period_end + 7200 });
    await until(() => sdk.testHelpers.testClocks.retrieve(clock.id), value => value.status === 'ready');
    await until(async () => receipts.filter(value => value.type === 'invoice.payment_failed' && value.status === 200).length, value => value > failuresBefore);
    expect(await asTenant(business, tx => tx`select invoice_id from billing_payment where business_id=${business}`)).toHaveLength(4);
    const [afterFailure] = await asTenant(business, tx => tx`select stripe_paid_through from business where id=${business}`);
    expect(String(afterFailure.stripe_paid_through)).toBe(String(coverage.stripe_paid_through));
    stage = 'period-end cancellation preserves already-paid coverage';
    await sdk.subscriptions.update(String(payments[0].subscription_id), { cancel_at_period_end: true });
    await pause(3000); expect((await access()).access.allowed).toBe(true);
    stage = 'real partial refund withdraws Stripe-owned access';
    await sdk.refunds.create({ payment_intent: String(payments[0].payment_intent_id), amount: 100 });
    await until(access, value => !value.access.allowed);
    expect((await access()).founderGroup).toBeNull();
    const [review] = await asTenant(business, tx => tx`select stripe_billing_review from business where id=${business}`);
    expect(review.stripe_billing_review).toBe(true);
    console.log('PASS genuine sandbox payment, signed delivery, owner activation, dedupe, 4 owned renewals, failed-renewal proof brake, period-end cancellation and partial-refund hold');
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'unknown failure') + ' ' + providerErrors.join(';');
    throw new Error(`${stage}: ${message.replace(/[sr]k_(?:live|test)_[A-Za-z0-9_]+/g, '[redacted]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 500)}`);
  }
});
