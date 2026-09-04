/* ============================================================
   The HTTP surface: status codes, validation, and who may call what.

   These go through the handlers as a browser would — a real Request
   with a real session cookie, resolved by resolveTenant like anything
   else. Auth gating and tenant scoping are route behaviour, and a test
   handed a ready-made identity would not be testing the route.

   This layer is where a whole class of bug lived: a value outside a
   CHECK constraint reached Postgres, the constraint fired, and the
   caller got a 500 for what was plainly a malformed request. Two full
   acceptance runs reported success while every policy write failed
   that way, because the script discarded status codes.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';
import { handleRepo } from '../src/routes/repo';
import { handleConnect } from '../src/routes/connect';
import {
  bindTelegramInternalChat,
  saveConnection,
  telegramInternalChat,
  webhookSecret,
} from '../src/connections';
import { finishRun, homeCounters, startRun } from '../src/runs';
import {
  enqueueRuntimeTask,
  leaseRuntimeTask,
  pauseRuntimeTaskForApproval,
} from '../src/runtime/tasks';
import { reserveRuntimeUsage } from '../src/runtime/usage';
import type { Env } from '../src/env';
import { ensureProviderRuntime, LocalRuntimeProvider } from '../src/runtime';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let env: Env;
let alice: string;
let bob: string;
let orphan: string;
let cookieA: string;
let cookieB: string;
let cookieOrphan: string;

const cors = {};

/** Call the fact/state routes the way index.ts does. */
async function state(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const { request, url } = req(method, path, opts);
  const res = await handleRepo(request, env, url, cors);
  if (!res) throw new Error(`no route matched ${method} ${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function conn(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const { request, url } = req(method, path, opts);
  const res = await handleConnect(request, env, url, cors);
  if (!res) throw new Error(`no route matched ${method} ${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function telegramHook(
  connectionId: string,
  secret: string,
  chatId: number,
  text: string,
  messageId = 1,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
) {
  const url = new URL(`https://api.test/api/webhooks/telegram/${A}/${connectionId}`);
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify({
      update_id: messageId,
      message: {
        message_id: messageId,
        date: 1,
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, first_name: 'Owner' },
        text,
      },
    }),
  });
  const response = await handleConnect(request, env, url, cors, ctx);
  if (!response) throw new Error('Telegram webhook did not match');
  return response;
}

async function telegramApprovalCallback(
  connectionId: string,
  secret: string,
  chatId: number,
  messageId: number,
  callbackId: string,
  data: string,
) {
  const url = new URL(`https://api.test/api/webhooks/telegram/${A}/${connectionId}`);
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify({
      update_id: 999,
      callback_query: {
        id: callbackId,
        from: { id: chatId, first_name: 'Owner' },
        data,
        message: {
          message_id: messageId,
          date: 1,
          chat: { id: chatId, type: 'private' },
        },
      },
    }),
  });
  const response = await handleConnect(request, env, url, cors);
  if (!response) throw new Error('Telegram webhook did not match');
  return response;
}

beforeEach(async () => {
  await truncateAll();
  env = testEnv();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    const [a] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('alice@example.com', true) returning id`;
    const [b] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('bob@example.com', true) returning id`;
    const [o] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('orphan@example.com', true) returning id`;
    alice = a.id;
    bob = b.id;
    orphan = o.id;
    await sql`insert into membership (user_id, business_id, role) values (${alice}, ${A}, 'owner')`;
    await sql`insert into membership (user_id, business_id, role) values (${bob}, ${B}, 'owner')`;
  });
  cookieA = await signIn(alice);
  cookieB = await signIn(bob);
  cookieOrphan = await signIn(orphan);
});

afterEach(() => vi.unstubAllGlobals());

describe('who may call these at all', () => {
  it('refuses without a session', async () => {
    for (const [m, p] of [
      ['POST', '/api/state/facts'],
      ['POST', '/api/state/facts/confirm'],
      ['GET', '/api/state'],
      ['GET', '/api/connections'],
      ['POST', '/api/connections/telegram'],
    ] as const) {
      const call = p.startsWith('/api/connections') ? conn : state;
      expect((await call(m, p, { body: {} })).status, `${m} ${p}`).toBe(401);
    }
  });

  it('refuses an expired session', async () => {
    await asOwner((sql) => sql`update session set expires_at = now() - interval '1 second'`);
    expect((await state('GET', '/api/state', { cookie: cookieA })).status).toBe(401);
  });

  it('refuses a revoked session, immediately', async () => {
    /* The property Hyperdrive's query cache silently broke once: a
       logout that does not take effect until a cache entry expires is
       a session that outlives its revocation. */
    await asOwner((sql) => sql`update session set revoked_at = now()`);
    expect((await state('GET', '/api/state', { cookie: cookieA })).status).toBe(401);
  });

  it('tells a signed-in user with no business what is missing', async () => {
    const r = await state('GET', '/api/state', { cookie: cookieOrphan });
    expect(r.status).toBe(404);
    // The client branches on this to run the local-to-remote migration.
    expect(r.body?.code).toBe('NO_BUSINESS');
  });
});

describe('creating the first business', () => {
  it('serializes concurrent first-login tabs to one business', async () => {
    const create = () => state('POST', '/api/state/business', {
      cookie: cookieOrphan,
      body: { name: 'One owner', playbookKey: 'generic' },
    });
    const responses = await Promise.all([create(), create()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const [{ businesses, memberships }] = await asOwner((sql) => sql<{
      businesses: string; memberships: string;
    }[]>`
      select count(distinct b.id)::text as businesses,
             count(m.business_id)::text as memberships
        from membership m join business b on b.id = m.business_id
       where m.user_id = ${orphan}`);
    expect({ businesses, memberships }).toEqual({ businesses: '1', memberships: '1' });
  });
});

describe('finishing onboarding provisions one Hermes runtime', () => {
  it('is an owner-only transition', async () => {
    const staffId = await asOwner(async (sql) => {
      const [staff] = await sql<{ id: string }[]>`
        insert into app_user (email, email_verified)
        values ('staff-alpha@example.com', true) returning id`;
      await sql`insert into membership (user_id, business_id, role)
                values (${staff.id}, ${A}, 'staff')`;
      return staff.id;
    });
    const staffCookie = await signIn(staffId);
    env = automaticRuntimeEnv(vi.fn(async () => {}));
    const response = await state('POST', '/api/state/onboarding/complete', {
      cookie: staffCookie,
      body: { playbookKey: 'restaurant', channels: ['Telegram'] },
    });
    expect(response.status).toBe(403);
  });

  it('atomically commits final answers and one release-deduplicated provisioning task', async () => {
    const send = vi.fn(async () => {});
    env = automaticRuntimeEnv(send);

    const completion = {
      playbookKey: 'bakery',
      channels: ['Telegram', 'Email'],
      name: 'Nora Bakes',
      locality: 'Shah Alam',
    };

    const first = await state('POST', '/api/state/onboarding/complete', {
      cookie: cookieA,
      body: completion,
    });
    const second = await state('POST', '/api/state/onboarding/complete', {
      cookie: cookieA,
      body: completion,
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ version: 1, businessId: A });
    const [row] = await asOwner((sql) => sql<{
      onboarded: boolean; playbook_key: string; channels: string[]; name: string;
      locality: string; count: string; kind: string; payload: Record<string, unknown>;
    }[]>`
      select b.onboarded, b.playbook_key, b.channels, b.name, b.locality,
             count(t.id)::text as count, min(t.kind) as kind,
             min(t.payload::text)::jsonb as payload
        from business b left join runtime_task t on t.business_id = b.id
       where b.id = ${A}
       group by b.onboarded, b.playbook_key, b.channels, b.name, b.locality`);
    expect(row).toMatchObject({
      onboarded: true,
      playbook_key: 'bakery',
      channels: ['Telegram', 'Email'],
      name: 'Nora Bakes',
      locality: 'Shah Alam',
      count: '1',
      kind: 'provision',
      payload: { release: '2026.08.28-8', trigger: 'onboarding_completed' },
    });
  });

  it('does not let onboarding completion skip required Telegram setup', async () => {
    const send = vi.fn(async () => {});
    env = automaticRuntimeEnv(send);
    const response = await state('POST', '/api/state/onboarding/complete', {
      cookie: cookieA,
      body: { playbookKey: 'restaurant', channels: [], setupDone: true },
    });

    expect(response.status).toBe(204);
    const [row] = await asOwner((sql) => sql<{
      onboarded: boolean; setup_done: boolean; channels: string[];
    }[]>`select onboarded, setup_done, channels from business where id = ${A}`);
    expect(row).toEqual({ onboarded: true, setup_done: false, channels: [] });
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps the durable task recoverable when Queue signaling fails', async () => {
    env = automaticRuntimeEnv(vi.fn(async () => { throw new Error('queue offline'); }));
    const failed = await state('POST', '/api/state/onboarding/complete', {
      cookie: cookieA,
      body: { playbookKey: 'restaurant', channels: ['Telegram'] },
    });
    expect(failed.status).toBe(503);

    const retrySend = vi.fn(async () => {});
    env = automaticRuntimeEnv(retrySend);
    const retried = await state('POST', '/api/state/onboarding/complete', {
      cookie: cookieA,
      body: { playbookKey: 'restaurant', channels: ['Telegram'] },
    });
    expect(retried.status).toBe(204);
    expect(retrySend).toHaveBeenCalledOnce();
    const [{ tasks, onboarded }] = await asOwner((sql) => sql<{
      tasks: string; onboarded: boolean;
    }[]>`
      select count(t.id)::text as tasks, bool_and(b.onboarded) as onboarded
        from business b left join runtime_task t on t.business_id = b.id
       where b.id = ${A}`);
    expect({ tasks, onboarded }).toEqual({ tasks: '1', onboarded: true });
  });

  it('does not let the legacy scalar setter bypass atomic completion', async () => {
    const response = await state('POST', '/api/state/onboarded', {
      cookie: cookieA,
      body: { value: true },
    });
    expect(response.status).toBe(409);
    const [row] = await asOwner((sql) => sql<{ onboarded: boolean; count: string }[]>`
      select b.onboarded, count(t.id)::text as count
        from business b left join runtime_task t on t.business_id = b.id
       where b.id = ${A} group by b.onboarded`);
    expect(row).toEqual({ onboarded: false, count: '0' });
  });

  it('does not allow setup to complete before onboarding', async () => {
    const response = await state('POST', '/api/state/setup-done', {
      cookie: cookieA,
      body: { value: true },
    });
    expect(response.status).toBe(409);
  });

  it('allows setup to complete after onboarding without forcing an external channel', async () => {
    env = automaticRuntimeEnv(vi.fn(async () => {}));
    expect((await state('POST', '/api/state/onboarding/complete', {
      cookie: cookieA,
      body: { playbookKey: 'restaurant', channels: ['Telegram'] },
    })).status).toBe(204);

    const completed = await state('POST', '/api/state/setup-done', {
      cookie: cookieA,
      body: { value: true },
    });
    expect(completed.status).toBe(204);
    const [business] = await asOwner((sql) => sql<{ setup_done: boolean }[]>`
      select setup_done from business where id = ${A}`);
    expect(business.setup_done).toBe(true);
  });
});

describe('recording a fact', () => {
  it('confirms the imported facts reviewed during onboarding in one request', async () => {
    for (const [key, value] of [
      ['business.name', 'Nora Bakes'],
      ['business.address', 'Shah Alam'],
    ]) {
      expect((await state('POST', '/api/state/facts', {
        cookie: cookieA,
        body: { key, value, source: 'agent', confidence: 0.9 },
      })).status).toBe(200);
    }

    const confirmed = await state('POST', '/api/state/facts/confirm-batch', {
      cookie: cookieA,
      body: { keys: ['business.name', 'business.address'] },
    });
    expect(confirmed.status).toBe(204);

    const snapshot = await state('GET', '/api/state', { cookie: cookieA });
    const facts = (snapshot.body?.snapshot as { facts: { confirmed: boolean }[] }).facts;
    expect(facts).toHaveLength(2);
    expect(facts.every((fact) => fact.confirmed)).toBe(true);
  });

  it('stores it and answers with what was stored', async () => {
    const r = await state('POST', '/api/state/facts', {
      cookie: cookieA,
      body: { key: 'hours.monday', value: '9am to 6pm' },
    });
    expect(r.status).toBe(200);
    const fact = r.body?.fact as Record<string, unknown>;
    expect(fact.key).toBe('hours.monday');
    expect(fact.version).toBe(1);
    // An owner stating a value is also vouching for it.
    expect(fact.source).toBe('owner');
    expect(fact.confirmed).toBe(true);
  });

  it('answers 400, never 500, for anything malformed', async () => {
    /* The regression. Each of these violates a CHECK constraint or a
       column type; reaching Postgres with them turns the caller's
       mistake into the server's error. */
    const bad: [string, unknown][] = [
      ['no key', { value: 1 }],
      ['empty key', { key: '', value: 1 }],
      ['capitalised key', { key: 'Hours.Monday', value: 1 }],
      ['spaced key', { key: 'hours monday', value: 1 }],
      ['no value', { key: 'a.b' }],
      ['confidence above one', { key: 'a.b', value: 1, confidence: 5 }],
      ['confidence below zero', { key: 'a.b', value: 1, confidence: -1 }],
      ['confidence not a number', { key: 'a.b', value: 1, confidence: 'high' }],
      ['unknown source', { key: 'a.b', value: 1, source: 'telepathy' }],
    ];
    for (const [why, body] of bad) {
      const r = await state('POST', '/api/state/facts', { cookie: cookieA, body });
      expect(r.status, why).toBe(400);
      expect(r.body?.err, why).toBeTruthy();
    }
  });

  it('keeps an agent guess unconfirmed', async () => {
    const r = await state('POST', '/api/state/facts', {
      cookie: cookieA,
      body: { key: 'a.b', value: 'x', source: 'agent', confidence: 0.5, sourceRef: 'https://x.com' },
    });
    const fact = r.body?.fact as Record<string, unknown>;
    expect(fact.confirmed).toBe(false);
    expect(fact.sourceRef).toBe('https://x.com');
  });

  it('supersedes rather than overwriting', async () => {
    await state('POST', '/api/state/facts', { cookie: cookieA, body: { key: 'a.b', value: 'one' } });
    const second = await state('POST', '/api/state/facts', {
      cookie: cookieA,
      body: { key: 'a.b', value: 'two' },
    });
    expect((second.body?.fact as Record<string, unknown>).version).toBe(2);

    const hist = await state('POST', '/api/state/facts/history', {
      cookie: cookieA,
      body: { key: 'a.b' },
    });
    expect((hist.body?.history as unknown[]).map((f) => (f as { value: unknown }).value)).toEqual([
      'two',
      'one',
    ]);
  });

  it('appears in the snapshot', async () => {
    await state('POST', '/api/state/facts', { cookie: cookieA, body: { key: 'a.b', value: 'x' } });
    const snap = await state('GET', '/api/state', { cookie: cookieA });
    const facts = (snap.body?.snapshot as { facts: { key: string }[] }).facts;
    expect(facts.map((f) => f.key)).toEqual(['a.b']);
  });
});

describe('confirming and forgetting', () => {
  it('reports 404 for a key that is not live', async () => {
    for (const path of ['/api/state/facts/confirm', '/api/state/facts/forget']) {
      const r = await state('POST', path, { cookie: cookieA, body: { key: 'never.existed' } });
      expect(r.status, path).toBe(404);
    }
  });

  it('confirms without changing confidence', async () => {
    await state('POST', '/api/state/facts', {
      cookie: cookieA,
      body: { key: 'a.b', value: 'x', source: 'agent', confidence: 0.4 },
    });
    expect((await state('POST', '/api/state/facts/confirm', { cookie: cookieA, body: { key: 'a.b' } })).status).toBe(204);

    const snap = await state('GET', '/api/state', { cookie: cookieA });
    const [fact] = (snap.body?.snapshot as { facts: { confirmed: boolean; confidence: number }[] }).facts;
    expect(fact.confirmed).toBe(true);
    // A human vouching does not make the model's guess a confident one.
    expect(fact.confidence).toBeCloseTo(0.4, 5);
  });

  it('forgets without losing the history', async () => {
    await state('POST', '/api/state/facts', { cookie: cookieA, body: { key: 'a.b', value: 'x' } });
    expect((await state('POST', '/api/state/facts/forget', { cookie: cookieA, body: { key: 'a.b' } })).status).toBe(204);

    const snap = await state('GET', '/api/state', { cookie: cookieA });
    expect((snap.body?.snapshot as { facts: unknown[] }).facts).toHaveLength(0);

    const hist = await state('POST', '/api/state/facts/history', { cookie: cookieA, body: { key: 'a.b' } });
    expect((hist.body?.history as unknown[])).toHaveLength(1);
  });
});

describe('one business cannot reach another', () => {
  it('sees only its own facts in the snapshot', async () => {
    await state('POST', '/api/state/facts', { cookie: cookieA, body: { key: 'alpha.only', value: 'x' } });
    const snap = await state('GET', '/api/state', { cookie: cookieB });
    expect((snap.body?.snapshot as { facts: unknown[] }).facts).toHaveLength(0);
  });

  it('cannot read another business’s history', async () => {
    await state('POST', '/api/state/facts', { cookie: cookieA, body: { key: 'alpha.only', value: 'x' } });
    const hist = await state('POST', '/api/state/facts/history', {
      cookie: cookieB,
      body: { key: 'alpha.only' },
    });
    expect(hist.body?.history).toHaveLength(0);
  });

  it('cannot confirm or forget another business’s fact', async () => {
    await state('POST', '/api/state/facts', { cookie: cookieA, body: { key: 'alpha.only', value: 'x' } });
    for (const path of ['/api/state/facts/confirm', '/api/state/facts/forget']) {
      const r = await state(path === '' ? 'POST' : 'POST', path, {
        cookie: cookieB,
        body: { key: 'alpha.only' },
      });
      expect(r.status, path).toBe(404);
    }
    // And A's fact is untouched.
    const snap = await state('GET', '/api/state', { cookie: cookieA });
    const [fact] = (snap.body?.snapshot as { facts: { confirmed: boolean }[] }).facts;
    expect(fact.confirmed).toBe(true);
  });
});

describe('connections', () => {
  it('does not count a saved Telegram bot as ready until the owner presses Start', async () => {
    const c = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, {
        connector: 'telegram',
        method: 'bot_token',
        externalId: '1',
        displayName: '@alpha_bot',
        secret: '123456789:SUPERSECRETTOKEN',
        connectedBy: alice,
      }));

    expect((await asTenant(A, (tx) => homeCounters(tx))).connections).toBe(0);
    expect(await asTenant(A, (tx) => bindTelegramInternalChat(tx, c.id, 42))).toBe('paired');
    expect((await asTenant(A, (tx) => homeCounters(tx))).connections).toBe(1);
  });

  it('rejects a token that is not shaped like one, before any network call', async () => {
    /* Checked before the value reaches anything that might log it, and
       before a request goes out carrying it. */
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    for (const token of ['', 'nonsense', '123:short', 'abcdef:AA' + 'x'.repeat(40)]) {
      const r = await conn('POST', '/api/connections/telegram', { cookie: cookieA, body: { token } });
      expect(r.status, token).toBe(400);
    }
    expect(spy, 'a malformed token was sent to Telegram').not.toHaveBeenCalled();
  });

  it('reports Telegram’s own words when it rejects a token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }))),
    );
    const r = await conn('POST', '/api/connections/telegram', {
      cookie: cookieA,
      body: { token: `123456789:${'A'.repeat(35)}` },
    });
    expect(r.status).toBe(400);
    // "Unauthorized" tells the owner they pasted the wrong thing.
    expect(String(r.body?.err)).toMatch(/unauthorized/i);
  });

  it('lists connections without ever including a secret', async () => {
    await asTenant(A, (tx) =>
      saveConnection(env, tx, A, {
        connector: 'telegram',
        method: 'bot_token',
        externalId: '1',
        displayName: '@alpha_bot',
        secret: '123456789:SUPERSECRETTOKEN',
        connectedBy: alice,
      }),
    );
    const r = await conn('GET', '/api/connections', { cookie: cookieA });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('SUPERSECRETTOKEN');
    const [connection] = r.body?.connections as {
      displayName: string; paired: boolean; pairingUrl: string;
    }[];
    expect(connection.displayName).toBe('@alpha_bot');
    expect(connection.paired).toBe(false);
    expect(connection.pairingUrl).toMatch(/^https:\/\/t\.me\/alpha_bot\?start=/);
  });

  it('pairs one private owner chat and refuses every other Telegram user', async () => {
    const c = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, {
        connector: 'telegram',
        method: 'bot_token',
        externalId: '1',
        displayName: '@alpha_bot',
        secret: '123456789:SUPERSECRETTOKEN',
        connectedBy: alice,
      }));
    const secret = await asTenant(A, (tx) => webhookSecret(tx, c.id));
    const listed = await conn('GET', '/api/connections', { cookie: cookieA });
    const [view] = listed.body?.connections as { pairingUrl: string }[];
    const code = new URL(view.pairingUrl).searchParams.get('start');
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);

    await telegramHook(c.id, secret, 999, 'Tell me the private business plan', 10);
    expect(await asTenant(A, (tx) => tx`select id from run`)).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      chat_id: 999,
      text: expect.stringMatching(/not paired.*press Start/i),
    });
    fetch.mockClear();

    await telegramHook(c.id, secret, 42, `/start ${code}`, 11);
    expect(await asTenant(A, (tx) => telegramInternalChat(tx, c.id))).toBe(42);
    fetch.mockClear();

    await telegramHook(c.id, secret, 999, `/start ${code}`, 12);
    expect(await asTenant(A, (tx) => telegramInternalChat(tx, c.id))).toBe(42);
    fetch.mockClear();
    await telegramHook(c.id, secret, 999, 'Try again', 13);
    expect(await asTenant(A, (tx) => tx`select id from run`)).toHaveLength(0);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      chat_id: 999,
      text: expect.stringMatching(/not authorised/i),
    });

    await telegramHook(c.id, secret, 42, 'Help me plan tomorrow', 14);
    expect(await asTenant(A, (tx) => tx`select id from run`)).toHaveLength(1);

    const refreshed = await conn('GET', '/api/connections', { cookie: cookieA });
    const [paired] = refreshed.body?.connections as { paired: boolean; pairingUrl: null }[];
    expect(paired).toMatchObject({ paired: true, pairingUrl: null });
  });

  it('hands an authorised runtime message to Queue before creating any run or task', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    const send = vi.fn(async () => {});
    env = automaticRuntimeEnv(send);
    const response = await telegramHook(
      paired.connectionId,
      paired.secret,
      42,
      'Please check our Sunday hours',
      30,
    );

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      version: 2,
      kind: 'telegram_intake',
      businessId: A,
      connectionId: paired.connectionId,
      incoming: {
        chatId: 42,
        messageId: 30,
        text: 'Please check our Sunday hours',
        privateChat: true,
      },
    });
    const [{ runs, tasks }] = await asOwner((sql) => sql<{ runs: string; tasks: string }[]>`
      select (select count(*)::text from run where business_id = ${A}) as runs,
             (select count(*)::text from runtime_task where business_id = ${A}) as tasks`);
    expect({ runs, tasks }).toEqual({ runs: '0', tasks: '0' });
    expect(fetch.mock.calls.map(([url]) => String(url)))
      .toEqual([expect.stringContaining('/sendChatAction')]);
  });

  it('authenticates an approval callback to its paired chat and resumes the same task', async () => {
    const queued: unknown[] = [];
    env = automaticRuntimeEnv(async (message) => { queued.push(message); });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/tasks/') && url.endsWith('/approval')) {
        return new Response(JSON.stringify({ ok: true, status: 'running' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    await ensureProviderRuntime({ ...env, RUNTIME_BOOTSTRAP_ENABLED: 'false' }, A, {
      provider: new LocalRuntimeProvider(),
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.message.telegram', runtime: 'hermes-sprite',
      model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      runId: run.id,
      dedupeKey: 'telegram:approval-callback',
      payload: {
        input: 'Research this source',
        telegram: {
          connectionId: paired.connectionId,
          chatId: 42,
          messageId: 30,
          from: 'Owner',
          question: 'Research this source',
          privateChat: true,
          liveMessageId: 55,
        },
      },
    }));
    const leaseToken = 'approval-owner';
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, task.id, leaseToken))).outcome).toBe('leased');
    const approval = await asTenant(A, async (tx) => {
      const paused = await pauseRuntimeTaskForApproval(tx, A, task.id, leaseToken, {
        requestId: 'a'.repeat(32),
        tool: 'execute_code',
        message: 'Allow execute_code to fetch the requested source?',
        connectionId: paired.connectionId,
        chatId: 42,
        messageId: 55,
        remoteRunId: 'hermes-run-approval',
        delaySeconds: 60,
      });
      await finishRun(tx, A, run.id, 'needs_approval', {
        runtimeTaskId: task.id,
        requestId: 'a'.repeat(32),
        tool: 'execute_code',
      });
      return paused;
    });
    expect(approval).not.toBeNull();
    fetch.mockClear();

    const forged = await telegramApprovalCallback(
      paired.connectionId,
      paired.secret,
      999,
      55,
      'callback-forged',
      `har:a:${approval!.id}`,
    );
    expect(forged.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();

    const accepted = await telegramApprovalCallback(
      paired.connectionId,
      paired.secret,
      42,
      55,
      'callback-valid',
      `har:a:${approval!.id}`,
    );
    expect(accepted.status).toBe(200);
    const runnerCall = fetch.mock.calls.find(([input]) => String(input).endsWith('/approval'));
    expect(runnerCall).toBeDefined();
    expect(JSON.parse(String(runnerCall?.[1]?.body))).toEqual({
      requestId: 'a'.repeat(32),
      decision: 'approve',
    });
    expect(fetch.mock.calls.some(([input]) => String(input).includes('/answerCallbackQuery')))
      .toBe(true);
    const edit = fetch.mock.calls.find(([input]) => String(input).includes('/editMessageText'));
    expect(JSON.parse(String(edit?.[1]?.body))).toMatchObject({
      chat_id: 42,
      message_id: 55,
      reply_markup: { inline_keyboard: [] },
    });
    expect(queued.at(-1)).toEqual({ version: 1, businessId: A, taskId: task.id });
    const [state] = await asOwner((sql) => sql<{ status: string; result: {
      approval: { status: string; decision: string };
    } }[]>`select status, result from runtime_task where id = ${task.id}`);
    expect(state.status).toBe('queued');
    expect(state.result.approval).toMatchObject({ status: 'approved', decision: 'approve' });
    const events = await asOwner((sql) => sql<{ type: string }[]>`
      select type from run_event where run_id = ${run.id} order by seq`);
    expect(events.map(({ type }) => type)).toEqual([
      'work.requested', 'approval.requested', 'approval.granted',
    ]);
  });

  it('timestamps latency from webhook receipt rather than after paid admission', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    const queued: unknown[] = [];
    let limiterFinishedAt = 0;
    env = {
      ...automaticRuntimeEnv(async (message) => { queued.push(message); }),
      AGENT_RUN_BURST: {
        limit: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          limiterFinishedAt = Date.now();
          return { success: true };
        },
      },
    };
    await telegramHook(paired.connectionId, paired.secret, 42, 'Measure the whole wait', 32);

    const intake = queued[0] as { requestedAtMs: number };
    expect(intake.requestedAtMs).toBeLessThan(limiterFinishedAt);
  });

  it('prewarms an existing Sprite without delaying the durable Queue handoff', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(url.endsWith('/healthz')
        ? 'ok'
        : JSON.stringify({ ok: true, result: { message_id: 99 } }));
    });
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    await asTenant(A, (tx) => tx`
      insert into agent_runtime
        (business_id, provider, provider_name, provider_url, status, desired_release)
      values
        (${A}, 'fly-sprite', 'alpha-runtime', 'https://alpha.sprites.app',
         'ready', '2026.09.01-5')`);
    const queued: unknown[] = [];
    env = automaticRuntimeEnv(async (message) => { queued.push(message); });
    const background: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        background.push(promise);
      },
    };

    const response = await telegramHook(
      paired.connectionId,
      paired.secret,
      42,
      'Wake up while this queues',
      33,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(queued).toHaveLength(1);
    expect(background).toHaveLength(1);
    await Promise.all(background);

    const prewarm = fetch.mock.calls.find(([input]) => String(input).endsWith('/healthz'));
    expect(prewarm).toBeDefined();
    expect(new Headers(prewarm?.[1]?.headers).get('Authorization'))
      .toBe('Bearer sprite-test-token');
  });

  it('returns 503 when Queue is unavailable so Telegram redelivers the message', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    env = automaticRuntimeEnv(async () => { throw new Error('queue offline'); });
    const response = await telegramHook(
      paired.connectionId,
      paired.secret,
      42,
      'Do not lose this message',
      31,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(fetch).not.toHaveBeenCalled();
    const [{ runs, tasks }] = await asOwner((sql) => sql<{ runs: string; tasks: string }[]>`
      select (select count(*)::text from run where business_id = ${A}) as runs,
             (select count(*)::text from runtime_task where business_id = ${A}) as tasks`);
    expect({ runs, tasks }).toEqual({ runs: '0', tasks: '0' });
  });

  it('/stop cancels the active queued run for the paired chat before paid admission', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      dedupeKey: 'telegram:stop-test',
      payload: {
        telegram: {
          connectionId: paired.connectionId,
          chatId: 42,
          privateChat: true,
          liveMessageId: 55,
        },
      },
    }));
    const otherChatTask = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      dedupeKey: 'telegram:other-chat-stop-test',
      payload: { telegram: { connectionId: paired.connectionId, chatId: 7 } },
    }));
    const admission = vi.fn(async () => ({ success: false }));
    env = testEnv({ AGENT_RUN_BURST: { limit: admission } });

    const response = await telegramHook(paired.connectionId, paired.secret, 42, '/stop', 20);

    expect(response.status).toBe(200);
    expect(admission).not.toHaveBeenCalled();
    const rows = await asTenant(A, (tx) => tx<{ id: string; status: string }[]>`
      select id, status from runtime_task where id in (${task.id}, ${otherChatTask.id})`);
    expect(rows.find(({ id }) => id === task.id)?.status).toBe('cancelled');
    expect(rows.find(({ id }) => id === otherChatTask.id)?.status).toBe('queued');
    const replies = fetch.mock.calls
      .filter(([url]) => String(url).includes('/sendMessage'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { text: string });
    expect(replies.some(({ text }) => text.includes('Stopped'))).toBe(true);
  });

  it('/stop finalizes usage for an in-flight run (remoteRunId) so the reservation cannot strand', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const send = vi.fn(async () => {});
    env = testEnv({ RUNTIME_QUEUE: { send } });
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    /* The 97002811 leak shape: task already reached the runner (remote_run_id
       set) and has a 100k reserved usage row. /stop must finalize it regardless
       of remoteRunId — previously the reservation sat 'reserved' forever and
       killed the monthly budget. */
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite',
      model: 'deepseek/deepseek-v4-flash-0731',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: 'telegram:stop-remote-test',
      payload: {
        telegram: {
          connectionId: paired.connectionId,
          chatId: 42,
          privateChat: true,
          liveMessageId: 55,
        },
      },
    }));
    await asTenant(A, (tx) => reserveRuntimeUsage(
      tx, A, task.id, 'deepseek/deepseek-v4-flash-0731'));
    await asOwner((sql) => sql`
      update runtime_task set remote_run_id = 'run-hermes-stop-1', remote_status = 'running'
       where id = ${task.id}`);

    const response = await telegramHook(paired.connectionId, paired.secret, 42, '/stop', 23);
    expect(response.status).toBe(200);

    const [state] = await asTenant(A, (tx) => tx<{
      task_status: string; usage_status: string; usage_input: string;
    }[]>`
      select t.status as task_status, u.status as usage_status, u.input_tokens::text as usage_input
        from runtime_task t
        join runtime_usage u on u.runtime_task_id = t.id
       where t.id = ${task.id}`);
    expect(state).toEqual({
      task_status: 'cancelled', usage_status: 'cancelled', usage_input: '0',
    });

    /* The control-plane cancel task is still published so the consumer stops
       the remote run; finalize already happened in the webhook, so the
       consumer's second finalize is a no-op (reservation is not stranded). */
    expect(send).toHaveBeenCalled();
    const replies = fetch.mock.calls
      .filter(([url]) => String(url).includes('/sendMessage'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { text: string });
    expect(replies.some(({ text }) => text.includes('Stopped'))).toBe(true);
  });

  it('/stop is a polite no-op when the paired chat has no active run', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    const response = await telegramHook(paired.connectionId, paired.secret, 42, '/stop', 21);

    expect(response.status).toBe(200);
    const replies = fetch.mock.calls
      .filter(([url]) => String(url).includes('/sendMessage'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { text: string });
    expect(replies.some(({ text }) => text === 'Nothing is running right now.')).toBe(true);
  });

  it('/stop from an unpaired chat cannot cancel the paired owner\'s run', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      dedupeKey: 'telegram:unpaired-stop-test',
      payload: {
        telegram: {
          connectionId: paired.connectionId,
          chatId: 42,
          privateChat: true,
        },
      },
    }));

    const response = await telegramHook(paired.connectionId, paired.secret, 999, '/stop', 22);

    expect(response.status).toBe(200);
    const [row] = await asTenant(A, (tx) => tx<{ status: string }[]>`
      select status from runtime_task where id = ${task.id}`);
    expect(row.status).toBe('queued');
    const replies = fetch.mock.calls
      .filter(([url]) => String(url).includes('/sendMessage'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { text: string });
    expect(replies.some(({ text }) => text.includes('Stopped'))).toBe(false);
    expect(replies.some(({ text }) => /not authorised/i.test(text))).toBe(true);
  });

  it('shows one business nothing of another’s', async () => {
    await asTenant(A, (tx) =>
      saveConnection(env, tx, A, {
        connector: 'telegram',
        method: 'bot_token',
        externalId: '1',
        displayName: '@alpha_bot',
        secret: 'x',
        connectedBy: alice,
      }),
    );
    const r = await conn('GET', '/api/connections', { cookie: cookieB });
    expect(r.body?.connections).toHaveLength(0);
  });

  it('will not let one business disconnect another’s bot', async () => {
    const c = await asTenant(A, (tx) =>
      saveConnection(env, tx, A, {
        connector: 'telegram',
        method: 'bot_token',
        externalId: '1',
        displayName: '@alpha_bot',
        secret: 'x',
        connectedBy: alice,
      }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    await conn('DELETE', `/api/connections/${c.id}`, { cookie: cookieB });

    // Still there for its owner.
    const mine = await conn('GET', '/api/connections', { cookie: cookieA });
    expect(mine.body?.connections).toHaveLength(1);
  });
});

function automaticRuntimeEnv(send: (message: unknown) => Promise<void>): Env {
  return testEnv({
    RUNTIME_RELEASE: '2026.08.28-8',
    RUNTIME_BUNDLE_COMMIT: 'a'.repeat(40),
    RUNTIME_PROVISIONING_ENABLED: 'true',
    MODEL_TRANSPORT_READY: 'true',
    RUNTIME_BOOTSTRAP_ENABLED: 'true',
    RUNTIME_EXECUTION_ENABLED: 'true',
    SPRITES_TOKEN: 'sprite-test-token',
    AISAR_OPENROUTER_MANAGEMENT_KEY: 'm'.repeat(32),
    AISAR_MODEL_PROVIDER: 'openrouter',
    AISAR_MODEL_BASE: 'https://openrouter.ai/api/v1',
    AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    RUNTIME_QUEUE: { send },
  });
}

async function pairTelegramChat(chatId: number): Promise<{
  connectionId: string;
  secret: string;
}> {
  const connection = await asTenant(A, (tx) =>
    saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: String(chatId),
      displayName: '@alpha_bot',
      secret: '123456789:SUPERSECRETTOKEN',
      connectedBy: alice,
    }));
  const secret = await asTenant(A, (tx) => webhookSecret(tx, connection.id));
  const listed = await conn('GET', '/api/connections', { cookie: cookieA });
  const view = (listed.body?.connections as { pairingUrl: string }[])
    .find((candidate) => candidate.pairingUrl);
  const code = view && new URL(view.pairingUrl).searchParams.get('start');
  if (!code) throw new Error('Telegram pairing code was not available');
  await telegramHook(connection.id, secret, chatId, `/start ${code}`, 10);
  return { connectionId: connection.id, secret };
}
