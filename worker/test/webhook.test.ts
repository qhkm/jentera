/* ============================================================
   The webhook: the only unauthenticated write path in the Worker.

   Everything else here is reached with a session. This endpoint is
   reached by Telegram, which has none, so its whole defence is the
   secret it presents — and its whole difficulty is that the row
   holding that secret is itself behind row-level security.

   That combination has already produced one bug that was invisible
   from both ends: Telegram reported every update delivered while the
   Worker refused every one of them, because a read with no tenant set
   returns nothing rather than failing. Both sides said "fine". These
   tests exist because nothing short of a real message found it.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asApp, asOwner, asTenant, truncateAll } from './harness';
import { saveConnection, verifyWebhook, webhookSecret } from '../src/connections';
import {
  parseUpdate,
  sendHermesMessage,
  TelegramLiveStream,
  withTypingIndicator,
} from '../src/connectors/telegram';
import type { Env } from '../src/env';

const env = { CREDENTIAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(3))) } as Env;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let connId: string;
let secret: string;
let userId: string;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    const [u] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    userId = u.id;
  });
  const c = await asTenant(A, (tx) =>
    saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '123',
      displayName: '@alpha_bot',
      secret: '123456789:AAtoken',
      connectedBy: userId,
    }),
  );
  connId = c.id;
  secret = await asTenant(A, (tx) => webhookSecret(tx, connId));
});

describe('authenticating an update', () => {
  it('accepts the right secret, inside the right tenant', async () => {
    expect(await asTenant(A, (tx) => verifyWebhook(tx, connId, secret))).toEqual({ ok: true });
  });

  it('refuses a wrong secret of the same length', async () => {
    /* Same length on purpose: a length check alone would pass this,
       and the constant-time comparison is what has to catch it. */
    const wrong = secret.slice(0, -1) + (secret.endsWith('a') ? 'b' : 'a');
    expect(wrong).toHaveLength(secret.length);
    const v = await asTenant(A, (tx) => verifyWebhook(tx, connId, wrong));
    expect(v).toMatchObject({ ok: false, why: 'secret mismatch' });
  });

  it('refuses an empty secret', async () => {
    const v = await asTenant(A, (tx) => verifyWebhook(tx, connId, ''));
    expect(v.ok).toBe(false);
  });

  it('refuses a secret that is a prefix of the real one', async () => {
    const v = await asTenant(A, (tx) => verifyWebhook(tx, connId, secret.slice(0, 10)));
    expect(v.ok).toBe(false);
  });

  it('refuses when the connection is not connected', async () => {
    await asTenant(A, (tx) => tx`update connection set status = 'revoked' where id = ${connId}`);
    const v = await asTenant(A, (tx) => verifyWebhook(tx, connId, secret));
    expect(v).toMatchObject({ ok: false, why: 'connection is revoked' });
  });

  it('refuses when no secret has been stored', async () => {
    /* The exact production failure: a connection with a correct URL,
       a valid token and no stored secret refuses every update, and
       Telegram reports each one delivered. */
    await asTenant(A, (tx) => tx`update connection set webhook_secret = null where id = ${connId}`);
    const v = await asTenant(A, (tx) => verifyWebhook(tx, connId, secret));
    expect(v).toMatchObject({ ok: false, why: 'no stored secret for that connection' });
  });
});

describe('the tenancy trap', () => {
  it('finds nothing when no tenant is set — the original bug', async () => {
    /* This is the regression. The handler used to read the connection
       through withUser, which sets no app.business_id; RLS then
       returned zero rows and the verdict was "no stored secret" for a
       secret that was sitting right there. Reading it as a miss rather
       than an error is precisely what made it invisible. */
    const v = await asApp((sql) =>
      verifyWebhook(sql as never, connId, secret),
    );
    expect(v).toMatchObject({ ok: false, why: 'no such connection for that business' });
  });

  it('finds nothing when scoped to the wrong tenant', async () => {
    const v = await asTenant(B, (tx) => verifyWebhook(tx, connId, secret));
    expect(v).toMatchObject({ ok: false, why: 'no such connection for that business' });
  });

  it('refuses a made-up connection id', async () => {
    const v = await asTenant(A, (tx) =>
      verifyWebhook(tx, '99999999-9999-4999-8999-999999999999', secret),
    );
    expect(v.ok).toBe(false);
  });

  it('will not let one business authenticate with another’s secret', async () => {
    /* The URL names the tenant, so an attacker can put any business id
       in it. What stops them is that the secret must belong to that
       business's own connection. */
    const other = await asTenant(B, (tx) =>
      saveConnection(env, tx, B, {
        connector: 'telegram',
        method: 'bot_token',
        externalId: '456',
        displayName: '@beta_bot',
        secret: '987654321:BBtoken',
        connectedBy: userId,
      }),
    );
    const betaSecret = await asTenant(B, (tx) => webhookSecret(tx, other.id));
    expect(betaSecret).not.toBe(secret);

    // Beta's secret against Alpha's connection, scoped to Alpha.
    expect(await asTenant(A, (tx) => verifyWebhook(tx, connId, betaSecret))).toMatchObject({
      ok: false,
    });
    // Alpha's connection id inside Beta's scope: invisible.
    expect(await asTenant(B, (tx) => verifyWebhook(tx, connId, secret))).toMatchObject({
      ok: false,
    });
  });
});

describe('reading an update', () => {
  const message = (over: Record<string, unknown> = {}) => ({
    update_id: 1,
    message: {
      message_id: 5,
      date: 1787000000,
      chat: { id: 42, type: 'private' },
      from: { id: 42, first_name: 'Aminah' },
      text: 'Are you open?',
      ...over,
    },
  });

  it('reads a plain message', () => {
    expect(parseUpdate(message())).toEqual({
      chatId: 42,
      messageId: 5,
      from: 'Aminah',
      text: 'Are you open?',
      privateChat: true,
    });
  });

  it('falls back to the username, then to something neutral', () => {
    expect(
      parseUpdate(message({ from: { id: 42, username: 'aminah_k' } }))?.from,
    ).toBe('aminah_k');
    expect(parseUpdate(message({ from: undefined }))?.from).toBe('Someone');
  });

  it('ignores everything it does not handle', () => {
    /* Returning null rather than throwing is deliberate: the caller
       answers 200 and Telegram moves on. Treating an unhandled shape
       as an error would have it redelivered every few seconds. */
    for (const body of [
      null,
      {},
      'not an object',
      { edited_message: { message_id: 1 } },
      { channel_post: { message_id: 1 } },
      message({ text: undefined }),
      message({ text: '   ' }),
      message({ chat: {} }),
      message({ message_id: undefined }),
    ]) {
      expect(parseUpdate(body)).toBeNull();
    }
  });

  it('truncates a very long message rather than refusing it', () => {
    const long = parseUpdate(message({ text: 'x'.repeat(9000) }));
    expect(long?.text).toHaveLength(4000);
  });

  it('does not mistake a caption or a sticker for text', () => {
    expect(parseUpdate(message({ text: undefined, caption: 'a photo' }))).toBeNull();
    expect(parseUpdate(message({ text: undefined, sticker: { emoji: '👍' } }))).toBeNull();
  });
});

describe('automatic reply typing', () => {
  it('refreshes without overlap, stops with the work, and has a hard cap', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: true })));
    vi.stubGlobal('fetch', fetch);
    let finish!: (value: string) => void;
    const work = new Promise<string>((resolve) => { finish = resolve; });

    const result = withTypingIndicator('123456789:AAtoken', 42, () => work, {
      refreshMs: 10,
      maxMs: 25,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(3);

    finish('done');
    await expect(result).resolves.toBe('done');
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not fail the answer when Telegram refuses the indicator', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: false }), { status: 400 })));

    await expect(withTypingIndicator(
      '123456789:AAtoken',
      42,
      async () => 'answer',
      { refreshMs: 10, maxMs: 20 },
    )).resolves.toBe('answer');
  });
});

describe('Hermes-style Telegram live bubbles', () => {
  it('persists the final answer as a copyable ordinary message', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);

    await sendHermesMessage('123456789:AAtoken', 42, 'Copy this answer');

    expect(String(fetch.mock.calls[0][0])).toContain('/sendMessage');
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      chat_id: 42,
      text: 'Copy this answer',
    });
  });

  it('creates a bot-owned bubble with sendMessage and never touches the composer', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.push('A');

    const sendCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/sendMessage'));
    expect(sendCalls()).toHaveLength(1);
    expect(JSON.parse(String(sendCalls()[0][1]?.body))).toMatchObject({
      chat_id: 42,
      text: 'A',
    });
    expect(stream.id).toBe(91);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('Draft'))).toBe(false);
  });

  it('reattaches to the admission bubble and edits it in place', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42, { messageId: 91 });

    await stream.setStatus('✅ System ready — waking AI…');

    const editCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/editMessageText'));
    expect(editCalls()).toHaveLength(1);
    expect(JSON.parse(String(editCalls()[0][1]?.body))).toMatchObject({
      chat_id: 42,
      message_id: 91,
      text: '✅ System ready — waking AI…',
    });
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/sendMessage'))).toBe(false);
  });

  it('publishes immediately, then at the 24-character buffer threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.push('A');
    await stream.push('short');
    const sendCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/sendMessage'));
    expect(sendCalls()).toHaveLength(1);
    await stream.push('x'.repeat(19));

    const editCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/editMessageText'));
    expect(editCalls()).toHaveLength(1);
    const second = JSON.parse(String(editCalls()[0][1]?.body)) as {
      message_id: number;
      text: string;
    };
    expect(second.message_id).toBe(91);
    expect(second.text).toBe(`Ashort${'x'.repeat(19)}`);
  });

  it('refreshes Telegram typing alongside the live bubble heartbeat', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.pulseTyping(true);
    await stream.push('A');
    fetch.mockClear();
    await vi.advanceTimersByTimeAsync(3_999);
    await stream.heartbeat();
    expect(fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await stream.heartbeat();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.every(([url]) => String(url).includes('/sendChatAction'))).toBe(true);
  });

  it('keeps the live bubble when Telegram refuses the typing action', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.pulseTyping(true);
    await stream.push('Visible answer');

    expect(String(fetch.mock.calls[0][0])).toContain('/sendChatAction');
    expect(String(fetch.mock.calls[1][0])).toContain('/sendMessage');
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
      chat_id: 42,
      text: 'Visible answer',
    });
  });

  it('publishes a working status as a fresh bubble when no bubble exists yet', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.setStatus('✅ System ready — waking AI…');

    const sendCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/sendMessage'));
    expect(sendCalls()).toHaveLength(1);
    const body = JSON.parse(String(sendCalls()[0][1]?.body)) as { text: string };
    expect(body.text).toContain('System ready');
  });

  it('status clears the moment answer text starts streaming', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.setStatus('⏳ Working… (12s)');
    fetch.mockClear();
    await stream.push('Here is the answer');

    const editCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/editMessageText'));
    expect(editCalls()).toHaveLength(1);
    const body = JSON.parse(String(editCalls()[0][1]?.body)) as { text: string };
    expect(body.text).toContain('Here is the answer');
    expect(body.text).not.toContain('Working');
  });

  it('ignores status updates once answer text has started', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.push('Started');
    fetch.mockClear();
    await stream.setStatus('⏳ Working… (99s)');

    expect(fetch.mock.calls.some(([url]) => String(url).includes('/editMessageText')))
      .toBe(false);
  });

  it('throttles status updates so stage churn cannot spam Telegram', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.setStatus('✅ System ready — waking AI…');
    fetch.mockClear();
    await stream.setStatus('✅ AI engine online — starting agent…');

    expect(fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    await stream.setStatus('✅ Agent started — thinking…');
    const editCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/editMessageText'));
    expect(editCalls()).toHaveLength(1);
    const body = JSON.parse(String(editCalls()[0][1]?.body)) as { text: string };
    expect(body.text).toContain('Agent started');
  });
});
