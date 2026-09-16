import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectWebhook, prepareWebhook, webhookSetup } from './setup-stripe-billing-webhook.mjs';
const endpoint = () => ({ id: 'we_fixture', livemode: true, status: 'disabled', url: webhookSetup.url,
  api_version: webhookSetup.apiVersion, metadata: { jentera_billing: webhookSetup.tag }, enabled_events: webhookSetup.events });
test('prepares a disabled exact-account webhook and pipes only its secret to the vault', async () => {
  const calls = []; const client = { accounts: { retrieve: async id => { assert.equal(id, null); return { id: webhookSetup.accountId, country: 'MY', charges_enabled: true }; } },
    webhookEndpoints: { list: async () => ({ has_more: false, data: [] }),
      create: async (params, options) => { calls.push('create'); assert.equal(params.connect, false); assert.deepEqual(params.enabled_events, webhookSetup.events); assert.ok(options.idempotencyKey); return { ...endpoint(), status: 'enabled', secret: 'whsec_fixture' }; },
      update: async (id, params) => { calls.push('disable'); assert.equal(id, 'we_fixture'); assert.deepEqual(params, { disabled: true }); return endpoint(); } } };
  assert.equal(await inspectWebhook(client), null);
  const result = await prepareWebhook(client, null, async secret => { calls.push('vault'); assert.equal(secret, 'whsec_fixture'); });
  assert.deepEqual(calls, ['create', 'disable', 'vault']); assert.equal(result.status, 'disabled');
  assert.equal(result.signingSecretInstalled, true); assert.equal(result.checkoutEnabled, false);
  assert.ok(!JSON.stringify(result).includes('whsec'));
});
test('never changes an existing enabled endpoint', async () => {
  await assert.rejects(prepareWebhook({}, { ...endpoint(), status: 'enabled' }, () => assert.fail()), /will not be changed/);
});
test('reusing an inactive endpoint does not pretend its secret was installed', async () => {
  const result = await prepareWebhook({}, endpoint(), () => assert.fail());
  assert.equal(result.created, false); assert.equal(result.signingSecretInstalled, false);
});
test('refuses another account and duplicate/mismatched endpoints', async () => {
  await assert.rejects(inspectWebhook({ accounts: { retrieve: async () => ({ id: 'acct_other' }) } }), /seller/);
  const account = { retrieve: async () => ({ id: webhookSetup.accountId, country: 'MY', charges_enabled: true }) };
  await assert.rejects(inspectWebhook({ accounts: account, webhookEndpoints: { list: async () => ({ has_more: false, data: [endpoint(), endpoint()] }) } }), /Multiple/);
  await assert.rejects(prepareWebhook({}, { ...endpoint(), enabled_events: ['*'] }, () => assert.fail()), /configuration/);
});
