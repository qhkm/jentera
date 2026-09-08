/* ============================================================
   The staff support routes: key authentication, and the one
   capability they grant — minting Telegram owner-pairing links.

   The pairing link is the boundary that binds an arbitrary chat
   as the internal owner chat, so the two real risks here are a
   missing/weak key check and a cross-tenant lookup. Both are
   asserted below.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, asTenant, req, testEnv, truncateAll } from './harness';
import { handleSupport } from '../src/routes/support';
import {
  bindTelegramInternalChat,
  saveConnection,
} from '../src/connections';
import type { Env } from '../src/env';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let env: Env;
const cors = {};

async function support(
  path: string,
  opts: { key?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const { request, url } = req('GET', path);
  if (opts.key) {
    request.headers.set('Authorization', `Bearer ${opts.key}`);
  }
  const res = await handleSupport(request, env, url, cors);
  if (!res) throw new Error(`no route matched ${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function seedBot(businessId: string, displayName = '@alpha_bot') {
  return asTenant(businessId, (tx) =>
    saveConnection(env, tx, businessId, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '1',
      displayName,
      secret: '123456789:SUPERSECRETTOKEN',
      connectedBy: '00000000-0000-4000-8000-000000000000',
    }),
  );
}

beforeEach(async () => {
  await truncateAll();
  env = testEnv({ AISAR_SUPPORT_KEY: 'support-secret' });
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    await sql`insert into app_user (id, email, email_verified)
              values ('00000000-0000-4000-8000-000000000000', 'alice@example.com', true)`;
    await sql`insert into membership (user_id, business_id, role)
              values ('00000000-0000-4000-8000-000000000000', ${A}, 'owner')`;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('authentication', () => {
  it('refuses when no key is presented', async () => {
    const r = await support('/api/support/telegram-pairing?businessId=' + A);
    expect(r.status).toBe(401);
  });

  it('refuses a wrong key', async () => {
    const r = await support('/api/support/telegram-pairing?businessId=' + A, {
      key: 'wrong-key',
    });
    expect(r.status).toBe(401);
  });

  it('fails closed when no support key is configured at all', async () => {
    env = testEnv({ AISAR_SUPPORT_KEY: '', AISAR_OPENROUTER_MANAGEMENT_KEY: '' });
    const r = await support('/api/support/telegram-pairing?businessId=' + A, {
      key: 'anything',
    });
    expect(r.status).toBe(503);
  });

  it('accepts the management key as a fallback', async () => {
    env = testEnv({ AISAR_SUPPORT_KEY: '', AISAR_OPENROUTER_MANAGEMENT_KEY: 'mgmt-secret' });
    await seedBot(A);
    const r = await support('/api/support/telegram-pairing?businessId=' + A, {
      key: 'mgmt-secret',
    });
    expect(r.status).toBe(200);
  });
});

describe('minting pairing links', () => {
  it('lists telegram connections with a code, deep link and /start command', async () => {
    const bot = await seedBot(A);
    const r = await support('/api/support/telegram-pairing?businessId=' + A, {
      key: 'support-secret',
    });
    expect(r.status).toBe(200);
    const [view] = r.body?.connections as Record<string, unknown>[];
    expect(view).toMatchObject({
      id: bot.id,
      connector: 'telegram',
      displayName: '@alpha_bot',
      paired: false,
      internalChat: null,
    });
    const code = view.code as string;
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(view.deepLink).toBe(`https://t.me/alpha_bot?start=${code}`);
    expect(view.startCommand).toBe(`/start ${code}`);
  });

  it('looks up one connection by id', async () => {
    const bot = await seedBot(A);
    const r = await support(
      `/api/support/telegram-pairing?businessId=${A}&connectionId=${bot.id}`,
      { key: 'support-secret' },
    );
    expect(r.status).toBe(200);
    const [view] = r.body?.connections as Record<string, unknown>[];
    expect(view?.id).toBe(bot.id);
    expect((view?.deepLink as string).startsWith('https://t.me/alpha_bot?start=')).toBe(true);
  });

  it('never reveals a code once paired — and reports the owner chat', async () => {
    const bot = await seedBot(A);
    await asTenant(A, (tx) => bindTelegramInternalChat(tx, bot.id, 42));
    const r = await support('/api/support/telegram-pairing?businessId=' + A, {
      key: 'support-secret',
    });
    const [view] = r.body?.connections as Record<string, unknown>[];
    expect(view).toMatchObject({ paired: true, internalChat: 42 });
    expect(view.code).toBeNull();
    expect(view.deepLink).toBeNull();
    /* A /start code for a paired bot could never rebind anyway, but
       support should not have it at all. */
    expect(view.startCommand).toBeNull();
  });

  it('hides connections that belong to a different business (RLS)', async () => {
    const bot = await seedBot(B);
    const r = await support(
      `/api/support/telegram-pairing?businessId=${A}&connectionId=${bot.id}`,
      { key: 'support-secret' },
    );
    expect(r.status).toBe(404);
  });

  it('omits non-telegram connections from the listing', async () => {
    await seedBot(A);
    await asTenant(A, (tx) =>
      saveConnection(env, tx, A, {
        connector: 'gmail',
        method: 'oauth',
        externalId: 'someone@gmail.com',
        displayName: 'someone@gmail.com',
        secret: 'oauth-token',
        connectedBy: '00000000-0000-4000-8000-000000000000',
      }),
    );
    const r = await support('/api/support/telegram-pairing?businessId=' + A, {
      key: 'support-secret',
    });
    const views = r.body?.connections as Record<string, unknown>[];
    expect(views).toHaveLength(1);
    expect(views[0].connector).toBe('telegram');
  });

  it('validates input shapes', async () => {
    expect((await support('/api/support/telegram-pairing', { key: 'support-secret' })).status).toBe(400);
    expect(
      (await support('/api/support/telegram-pairing?businessId=not-a-uuid', { key: 'support-secret' }))
        .status,
    ).toBe(400);
    expect(
      (
        await support(
          `/api/support/telegram-pairing?businessId=${A}&connectionId=nope`,
          { key: 'support-secret' },
        )
      ).status,
    ).toBe(400);
    const r = await support('/api/support/telegram-pairing?businessId=' + A, {
      key: 'support-secret',
    });
    const missing = r.body?.connections as Record<string, unknown>[];
    expect(missing).toHaveLength(0);
    expect((await support('/api/support/unknown', { key: 'support-secret' })).status).toBe(404);
  });
});

describe('announcements to owners', () => {
  const text = 'Heads up: AI credits are capped at US$5 a month until launch.';

  async function announce(payload: unknown, key = 'support-secret') {
    const { request, url } = req('POST', '/api/support/announce', { body: payload });
    request.headers.set('Authorization', `Bearer ${key}`);
    const res = await handleSupport(request, env, url, cors);
    if (!res) throw new Error('no route matched /api/support/announce');
    return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> };
  }

  it('dry-runs a Telegram announcement: lists paired owner chats and sends nothing', async () => {
    const bot = await seedBot(A);
    await asTenant(A, (tx) => bindTelegramInternalChat(tx, bot.id, 42));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const r = await announce({ businessIds: [A], channel: 'telegram', text, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([
      { businessId: A, channel: 'telegram', target: 'chat:42', outcome: 'would_send' },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a Telegram announcement to each paired owner chat and skips unpaired businesses', async () => {
    const bot = await seedBot(A);
    await asTenant(A, (tx) => bindTelegramInternalChat(tx, bot.id, 42));
    await seedBot(B, '@beta_bot');
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const r = await announce({ businessIds: [A, B], channel: 'telegram', text });
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([
      { businessId: A, channel: 'telegram', target: 'chat:42', outcome: 'sent' },
      { businessId: B, channel: 'telegram', target: null, outcome: 'no_paired_chat' },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain('/bot123456789:SUPERSECRETTOKEN/sendMessage');
    expect(sent[0].body).toMatchObject({ chat_id: 42, text });
  });

  it('emails every owner of the named businesses', async () => {
    env = testEnv({ AISAR_SUPPORT_KEY: 'support-secret', RESEND_API_KEY: 're_test' });
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    }));
    const r = await announce({
      businessIds: [A], channel: 'email', subject: 'AI credits during pre-launch', text,
    });
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([
      { businessId: A, channel: 'email', target: 'email:alice@example.com', outcome: 'sent' },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.resend.com/emails');
    expect(sent[0].body).toMatchObject({
      to: ['alice@example.com'],
      subject: 'AI credits during pre-launch',
    });
    expect(String(sent[0].body.text)).toContain(text);
  });

  it('refuses malformed announcements before touching any tenant', async () => {
    expect((await announce({ businessIds: ['nope'], channel: 'telegram', text })).status).toBe(400);
    expect((await announce({ businessIds: [A], channel: 'sms', text })).status).toBe(400);
    expect((await announce({ businessIds: [A], channel: 'telegram', text: '' })).status).toBe(400);
    expect((await announce({ businessIds: [A], channel: 'email', text })).status).toBe(400);
  });
});
