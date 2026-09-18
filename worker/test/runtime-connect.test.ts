import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { claimRuntime } from '../src/agent-runtime';
import { deriveJenteraRuntimeCredential } from '../src/runtime/openrouter-keys';
import { handleRuntimeConnect, RUNTIME_CONNECT_PATH } from '../src/routes/runtime-connect';
import { asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const RID = 'aisar-b-aaaaaaaaaaaaaaaaaaaa';
const SECRET = 'fmcv-control-secret-'.padEnd(48, 's');
const TOKEN = ['b'.repeat(20), 'c'.repeat(40), 'd'.repeat(43)].join('.');
let key: string;
let ownerId: string;

const env = (over: Record<string, unknown> = {}): Env =>
  testEnv({ AISAR_MODEL_KEY: SECRET, SPRITES_TOKEN: 'sprite-token', ...over });

async function call(body: unknown, overEnv: Env = env(), token: string | null = key) {
  const request = new Request(`https://api.test${RUNTIME_CONNECT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const response = await handleRuntimeConnect(request, overEnv, new URL(request.url), {});
  if (!response) throw new Error('connect route did not match');
  return response;
}

/** The runner's browser API, which the worker reaches over the sealed key. */
function runnerFake(reply: unknown, status = 200) {
  return fetchFake(async () => new Response(JSON.stringify(reply), { status }));
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    const [o] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    ownerId = o.id;
    await sql`insert into membership (user_id, business_id, role) values (${o.id}, ${A}, 'owner')`;
  });
  await asTenant(A, (tx) => claimRuntime(env(), tx, A, {
    provider: 'fly-sprite', providerName: RID, release: '2026.09.18-3',
    runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
  }));
  /* The harvest step reaches the runner over its provider URL. */
  await asOwner((sql) => sql`
    update agent_runtime set provider_url = ${'https://' + RID + '-x1.sprites.app'}, status = 'ready'
     where business_id = ${A}`);
  key = (await deriveJenteraRuntimeCredential(SECRET, RID)).key;
});
afterEach(() => vi.unstubAllGlobals());

describe('helping an owner set a service up', () => {
  it('offers the ways that exist, for the owner to choose', async () => {
    const body = await (await call({ service: 'my bukku' })).json() as {
      choose: { method: string; caution?: string }[];
    };
    expect(body.choose.map((c) => c.method)).toEqual(['api_token', 'browser']);
    /* The owner is choosing between convenience and exposure, so the
       exposure travels with the offer. */
    expect(body.choose.find((c) => c.method === 'browser')?.caution).toMatch(/can see it/i);
  });

  it('refuses a way the service does not offer', async () => {
    expect((await call({ service: 'bukku', method: 'mcp' })).status).toBe(400);
    expect((await call({ service: 'autocount' })).status).toBe(400);
  });

  it('sends a token setup to the form, and tells the agent not to take one', async () => {
    const body = await (await call({ service: 'bukku', method: 'api_token' })).json() as
      { action: string; note: string };
    expect(body.action).toBe('open_connections');
    /* A token pasted into chat is a token in a model's context and in the
       durable transcript. */
    expect(body.note).toMatch(/never ask the owner to paste a token into the chat/i);
  });

  it('asks for the company before it can say where to sign in', async () => {
    const body = await (await call({ service: 'bukku', method: 'browser' })).json() as
      { need: string; err: string };
    expect(body.need).toBe('account');
    const ok = await (await call({ service: 'bukku', method: 'browser', account: 'aisar' })).json() as
      { action: string; url: string; instructions: string };
    expect(ok).toMatchObject({ action: 'open_browser', url: 'https://aisar.bukku.my/' });
    expect(ok.instructions).toMatch(/do not type their password/i);
  });

  it('reads the settings the sign-in made available, proves them, and stores them', async () => {
    const runner = runnerFake({ ok: true, fields: { token: TOKEN, subdomain: 'aisar' } });
    /* The runner answers first, then Bukku verifies. */
    let call$ = 0;
    vi.stubGlobal('fetch', fetchFake(async (input, init) => {
      call$ += 1;
      if (call$ === 1) return runner(input, init);
      return Response.json({ companies: [{ id: 1, legal_name: 'Aisar AI', subdomain: 'aisar' }] });
    }));
    const body = await (await call({ service: 'bukku', method: 'browser', step: 'finish' })).json() as
      { ok: boolean; connected: string };
    expect(body).toMatchObject({ ok: true, connected: 'Aisar AI' });
    /* Stored sealed, attributed to the owner, and never echoed to the agent. */
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    const [row] = await asOwner((sql) => sql<{ connector: string; connected_by: string }[]>`
      select connector, connected_by from connection where business_id = ${A}`);
    expect(row).toMatchObject({ connector: 'Bukku', connected_by: ownerId });
  });

  it('answers the runner’s refusals in words the owner can act on', async () => {
    for (const [error, expected] of [
      ['browser_not_signed_in', /sign in to Bukku/i],
      ['browser_control_expired', /take control/i],
      ['browser_unexpected_token', /paste a token instead/i],
    ] as const) {
      vi.stubGlobal('fetch', runnerFake({ error }, 409));
      const body = await (await call({ service: 'bukku', method: 'browser', step: 'finish' })).json() as { err: string };
      expect(body.err).toMatch(expected);
    }
    expect(await asOwner((sql) => sql`select 1 from connection where business_id = ${A}`)).toHaveLength(0);
  });

  it('stores nothing when the settings do not open the company', async () => {
    let n = 0;
    vi.stubGlobal('fetch', fetchFake(async () => {
      n += 1;
      if (n === 1) return Response.json({ ok: true, fields: { token: TOKEN, subdomain: 'aisar' } });
      /* Bukku says the token is not for that company. */
      return new Response('{}', { status: 403 });
    }));
    expect((await call({ service: 'bukku', method: 'browser', step: 'finish' })).status).toBe(409);
    expect(await asOwner((sql) => sql`select 1 from connection where business_id = ${A}`)).toHaveLength(0);
  });

  it('refuses without a runtime credential', async () => {
    expect((await call({ service: 'bukku' }, env(), null)).status).toBe(401);
  });
});
