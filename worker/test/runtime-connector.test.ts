import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { claimRuntime } from '../src/agent-runtime';
import { saveConnection } from '../src/connections';
import { deriveJenteraRuntimeCredential } from '../src/runtime/openrouter-keys';
import { handleRuntimeConnector, RUNTIME_CONNECTOR_PATH } from '../src/routes/runtime-connector';
import { startRun } from '../src/runs';
import { asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const RID_A = 'aisar-b-aaaaaaaaaaaaaaaaaaaa';
const RID_B = 'aisar-b-bbbbbbbbbbbbbbbbbbbb';
const CONTROL_SECRET = 'fmcv-control-secret-'.padEnd(48, 's');
const TOKEN = ['b'.repeat(20), 'c'.repeat(40), 'd'.repeat(43)].join('.');
const INVOICE = {
  id: 1, number: 'IV-00231', contact_name: 'Alex Wong', contact_email: 'alex@example.com',
  date: '2026-09-01', amount: 2000, currency_code: 'MYR', status: 'ready',
};

let keyA: string;
let keyB: string;
let runA: string;
let ownerA: string;

const env = (over: Record<string, unknown> = {}): Env =>
  testEnv({ AISAR_MODEL_KEY: CONTROL_SECRET, ...over });

async function call(body: unknown, token: string | null = keyA, overEnv: Env = env()) {
  const request = new Request(`https://api.test${RUNTIME_CONNECTOR_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await handleRuntimeConnector(request, overEnv, new URL(request.url), {});
  if (!response) throw new Error('connector route did not match');
  return response;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'retail')`;
    const [o] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    ownerA = o.id;
    await sql`insert into membership (user_id, business_id, role) values (${o.id}, ${A}, 'owner')`;
  });
  for (const [business, rid] of [[A, RID_A], [B, RID_B]] as const) {
    await asTenant(business, (tx) => claimRuntime(env(), tx, business, {
      provider: 'fly-sprite', providerName: rid, release: '2026.09.12-1',
      runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
    }));
  }
  await asTenant(A, (tx) => saveConnection(env(), tx, A, {
    connector: 'Bukku', method: 'api_token', externalId: 'aisar',
    displayName: 'Aisar AI', secret: TOKEN, connectedBy: ownerA,
  }));
  const run = await asTenant(A, (tx) => startRun(tx, A, {
    kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'deepseek',
  }));
  runA = run.id;
  keyA = (await deriveJenteraRuntimeCredential(CONTROL_SECRET, RID_A)).key;
  keyB = (await deriveJenteraRuntimeCredential(CONTROL_SECRET, RID_B)).key;
});
afterEach(() => vi.unstubAllGlobals());

describe('the agent asking the control plane to use a connector', () => {
  it('reads the owner’s Bukku without the token ever leaving the worker', async () => {
    vi.stubGlobal('fetch', fetchFake(async () => Response.json({ transactions: [INVOICE] })));
    const response = await call({
      connector: 'Bukku', op: 'list',
      args: { resource: 'invoices', paymentStatus: 'OVERDUE' }, runId: runA,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; detail: string };
    expect(body).toMatchObject({ ok: true });
    expect(body.detail).toContain('IV-00231');
    /* Whatever else this returns, it must never be the credential. */
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  /* The invariant the tenancy model was rebuilt around: nothing in the
     request may choose a business. Beta's runtime has no Bukku. */
  it('serves the credential’s tenant, never one named in the request', async () => {
    vi.stubGlobal('fetch', fetchFake(async () => Response.json({ transactions: [INVOICE] })));
    const response = await call({
      connector: 'Bukku', op: 'list', businessId: A, business: A,
      args: { resource: 'invoices' },
    }, keyB);
    expect(response.status).toBe(422);
    expect((await response.json() as { err: string }).err).toMatch(/not connected/i);
  });

  it('refuses a payment outright rather than queueing it', async () => {
    const response = await call({ connector: 'Bukku', op: 'pay', args: {} });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'blocked' });
  });

  it('tells the agent to ask the owner instead of acting unapproved', async () => {
    /* `send` is high risk; an unknown op defaults to medium, never to low. */
    for (const op of ['send', 'update', 'reticulate_splines']) {
      const response = await call({ connector: 'Bukku', op, args: {} });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'needs_approval' });
    }
  });

  it('refuses an unknown credential, and a missing one', async () => {
    expect((await call({ connector: 'Bukku', op: 'list' }, null)).status).toBe(401);
    expect((await call({ connector: 'Bukku', op: 'list' }, 'sk-jentera-v1.nonsense')).status).toBe(401);
  });

  it('names the connectors it does have when asked for one it does not', async () => {
    const response = await call({ connector: 'Xero', op: 'list' });
    expect(response.status).toBe(400);
    expect((await response.json() as { connectors: string[] }).connectors).toContain('Bukku');
  });

  it('records that the books were read, but not what they said', async () => {
    vi.stubGlobal('fetch', fetchFake(async () => Response.json({ transactions: [INVOICE] })));
    await call({ connector: 'Bukku', op: 'list', args: { resource: 'invoices' }, runId: runA });
    const [event] = await asOwner((sql) => sql<{ type: string; payload: Record<string, unknown> }[]>`
      select type, payload from run_event where run_id = ${runA} and type = 'action.executed'`);
    expect(event.payload).toMatchObject({ connector: 'Bukku', op: 'list', resource: 'invoices' });
    /* An audit row is not a place to keep a list of who owes money. */
    expect(JSON.stringify(event.payload)).not.toContain('Alex Wong');
  });

  it('ignores a run id belonging to someone else', async () => {
    vi.stubGlobal('fetch', fetchFake(async () => Response.json({ transactions: [INVOICE] })));
    const other = await asTenant(B, (tx) => startRun(tx, B, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'deepseek',
    }));
    const response = await call({ connector: 'Bukku', op: 'list', args: {}, runId: other.id });
    expect(response.status).toBe(200);
    /* `startRun` writes its own `work.requested`, so the question is
       whether this route added to a run that is not its tenant's. */
    expect(await asOwner((sql) => sql`
      select 1 from run_event where run_id = ${other.id} and type = 'action.executed'`))
      .toHaveLength(0);
  });

  it('only accepts POST', async () => {
    const request = new Request(`https://api.test${RUNTIME_CONNECTOR_PATH}`, { method: 'GET' });
    const response = await handleRuntimeConnector(request, env(), new URL(request.url), {});
    expect(response?.status).toBe(405);
  });
});
