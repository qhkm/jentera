#!/usr/bin/env node
import Stripe from 'stripe';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const webhookSetup = {
  accountId: 'acct_1UG90wHuvvz49fq3', url: 'https://api.jentera.ai/api/webhooks/stripe',
  apiVersion: '2026-08-26.dahlia', tag: 'jentera-launch-billing-v1',
  events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
    'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
    'invoice.paid', 'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'],
};
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };
function validate(endpoint) {
  requireCondition(endpoint.livemode && endpoint.url === webhookSetup.url && endpoint.api_version === webhookSetup.apiVersion
    && endpoint.metadata?.jentera_billing === webhookSetup.tag && !endpoint.application
    && JSON.stringify([...endpoint.enabled_events].sort()) === JSON.stringify([...webhookSetup.events].sort()), 'Webhook configuration requires operator review.');
}
export async function inspectWebhook(client) {
  const account = await client.accounts.retrieve(null);
  requireCondition(account.id === webhookSetup.accountId && account.country === 'MY' && account.charges_enabled, 'Unexpected Stripe seller account.');
  const endpoints = await client.webhookEndpoints.list({ limit: 100 });
  requireCondition(!endpoints.has_more, 'More than 100 webhook endpoints require operator review.');
  const matches = endpoints.data.filter(endpoint => endpoint.url === webhookSetup.url || endpoint.metadata?.jentera_billing === webhookSetup.tag);
  requireCondition(matches.length <= 1, 'Multiple matching webhook endpoints require operator review.');
  if (matches[0]) validate(matches[0]);
  return matches[0] ?? null;
}
export async function prepareWebhook(client, existing, saveSecret) {
  if (existing) {
    validate(existing);
    requireCondition(existing.status === 'disabled', 'Existing enabled webhook will not be changed.');
    return { id: existing.id, status: existing.status, created: false, signingSecretInstalled: false, checkoutEnabled: false };
  }
  const created = await client.webhookEndpoints.create({ url: webhookSetup.url, api_version: webhookSetup.apiVersion,
    enabled_events: webhookSetup.events, connect: false, description: 'Jentera verified subscription activation',
    metadata: { jentera_billing: webhookSetup.tag } }, { idempotencyKey: `${webhookSetup.accountId}:${webhookSetup.tag}:create` });
  const disabled = await client.webhookEndpoints.update(created.id, { disabled: true },
    { idempotencyKey: `${webhookSetup.accountId}:${webhookSetup.tag}:disable-draft` });
  validate(disabled); requireCondition(disabled.status === 'disabled', 'Disabled webhook read-back required.');
  requireCondition(/^whsec_[a-zA-Z0-9]+$/.test(created.secret ?? ''), 'Signing secret was not returned; install it directly in the Worker vault.');
  await saveSecret(created.secret);
  return { id: disabled.id, status: 'disabled', created: true, signingSecretInstalled: true, checkoutEnabled: false };
}
async function saveWorkerSecret(secret) {
  await new Promise((resolve, reject) => {
    // Pipe directly to the platform vault. No secret argv, file, console or
    // retained child output. Updating a secret never opens the checkout gate.
    const child = spawn('pnpm', ['exec', 'wrangler', 'secret', 'put', 'STRIPE_WEBHOOK_SECRET'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Worker vault installation timed out.')); }, 45000);
    child.on('error', () => { clearTimeout(timeout); reject(new Error('Worker vault installation failed.')); });
    child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Worker vault installation failed.')); });
    child.stdin.on('error', () => {}); child.stdin.end(secret + '\n');
  });
}
async function main() {
  const [mode, account] = process.argv.slice(2);
  requireCondition(process.argv.length === 3 && mode === '--inspect' || process.argv.length === 4 && mode === '--prepare' && account === webhookSetup.accountId,
    'Use --inspect or --prepare ACCOUNT_ID. No enable or key argument is supported.');
  requireCondition(process.stdin.isTTY, 'Use a terminal with echo disabled.');
  process.stderr.write('Restricted key input ready; terminal echo must be disabled.\n');
  const input = createInterface({ input: process.stdin, terminal: false });
  let key = await new Promise(resolve => input.once('line', resolve)); input.close();
  requireCondition(/^rk_live_[a-zA-Z0-9]+$/.test(key), 'A live restricted credential is required.');
  const client = new Stripe(key, { apiVersion: webhookSetup.apiVersion, timeout: 10000, maxNetworkRetries: 1 }); key = undefined;
  const endpoint = await inspectWebhook(client);
  const result = mode === '--prepare' ? await prepareWebhook(client, endpoint, saveWorkerSecret)
    : { accountId: webhookSetup.accountId, endpoint: endpoint ? { id: endpoint.id, status: endpoint.status } : null, checkoutEnabled: false };
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  const safe = error instanceof Stripe.errors.StripeError ? { ok: false, type: error.type, status: error.statusCode, code: error.code, requestId: error.requestId }
    : { ok: false, error: error.message };
  console.error(JSON.stringify(safe)); process.exitCode = 1;
});
