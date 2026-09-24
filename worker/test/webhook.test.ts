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
import { asApp, asOwner, asTenant, fetchFake, truncateAll } from './harness';
import { saveConnection, verifyWebhook, webhookSecret } from '../src/connections';
import {
  parseCallbackQuery,
  parseUpdate,
  sendHermesMessage,
  TelegramLiveStream,
  setWebhook,
  unreadableReply,
  withTypingIndicator,
  withUnseenMediaNote,
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

  it('does not mistake a bare caption for text, and marks a sticker as unseen', () => {
    /* A caption with nothing it captions cannot happen in Telegram, and
       must not become a question if it does. */
    expect(parseUpdate(message({ text: undefined, caption: 'a photo' }))).toBeNull();
    expect(parseUpdate(message({ text: undefined, sticker: { emoji: '👍' } })))
      .toMatchObject({ text: '', unseen: 'sticker' });
  });

  it('reads a captioned photo or file as its caption, marked unseen', () => {
    expect(parseUpdate(message({
      text: undefined,
      caption: 'Record this receipt',
      photo: [{ file_id: 'small' }, { file_id: 'large' }],
    }))).toEqual({
      chatId: 42,
      messageId: 5,
      from: 'Aminah',
      text: 'Record this receipt',
      privateChat: true,
      unseen: 'photo',
    });
    expect(parseUpdate(message({
      text: undefined,
      caption: 'Summarise this',
      document: { file_id: 'd', file_name: 'contract.pdf' },
    }))).toMatchObject({ text: 'Summarise this', unseen: 'document' });
  });

  it('reads media with nothing to answer as empty text, marked unseen', () => {
    expect(parseUpdate(message({ text: undefined, photo: [{ file_id: 'p' }] })))
      .toMatchObject({ text: '', unseen: 'photo' });
    expect(parseUpdate(message({ text: undefined, caption: '   ', document: { file_id: 'd' } })))
      .toMatchObject({ text: '', unseen: 'document' });
    /* Only photos and files have their caption read in the stopgap. */
    expect(parseUpdate(message({
      text: undefined,
      caption: 'listen to this',
      voice: { file_id: 'v', duration: 4 },
    }))).toMatchObject({ text: '', unseen: 'voice' });
    expect(parseUpdate(message({ text: undefined, caption: 'watch', video: { file_id: 'x' } })))
      .toMatchObject({ text: '', unseen: 'video' });
  });

  it('calls a GIF a GIF, though Telegram also sends it as a document', () => {
    expect(parseUpdate(message({
      text: undefined,
      caption: 'lol',
      animation: { file_id: 'g' },
      document: { file_id: 'g' },
    }))).toMatchObject({ text: '', unseen: 'animation' });
  });

  it('notes a caption it did not read, on a voice note or video', () => {
    expect(parseUpdate(message({ text: undefined, caption: 'listen to this', voice: { file_id: 'v' } })))
      .toMatchObject({ text: '', unseen: 'voice', captionIgnored: true });
    expect(parseUpdate(message({ text: undefined, caption: 'watch', video: { file_id: 'x' } })))
      .toMatchObject({ text: '', unseen: 'video', captionIgnored: true });
    expect(parseUpdate(message({ text: undefined, voice: { file_id: 'v' } })))
      .not.toHaveProperty('captionIgnored');
    expect(parseUpdate(message({ text: undefined, caption: '   ', video: { file_id: 'x' } })))
      .not.toHaveProperty('captionIgnored');
    /* A photo's caption is read, so nothing was ignored. */
    expect(parseUpdate(message({ text: undefined, caption: 'Record this', photo: [{ file_id: 'p' }] })))
      .not.toHaveProperty('captionIgnored');
  });

  it('recognises polls, dice, stories, games and paid media', () => {
    const shapes: [string, Record<string, unknown>][] = [
      ['poll', { id: '1', question: 'Lunch?', options: [] }],
      ['dice', { emoji: '🎲', value: 4 }],
      ['story', { chat: { id: 1 }, id: 2 }],
      ['game', { title: 'Snake' }],
      ['paid_media', { star_count: 5, paid_media: [] }],
    ];
    for (const [field, value] of shapes) {
      expect(parseUpdate(message({ text: undefined, [field]: value })))
        .toMatchObject({ text: '', unseen: field });
    }
  });

  it('keeps the album an item belongs to', () => {
    expect(parseUpdate(message({
      text: undefined,
      media_group_id: '13579',
      photo: [{ file_id: 'p' }],
    }))).toMatchObject({ text: '', unseen: 'photo', mediaGroupId: '13579' });
    expect(parseUpdate(message({ text: undefined, photo: [{ file_id: 'p' }] })))
      .not.toHaveProperty('mediaGroupId');
  });

  it('reads a venue as a location, and stays silent on service messages', () => {
    expect(parseUpdate(message({
      text: undefined,
      venue: { title: 'Kedai', address: 'Jalan 1', location: { latitude: 3.1, longitude: 101.7 } },
      location: { latitude: 3.1, longitude: 101.7 },
    }))).toMatchObject({ text: '', unseen: 'location' });
    for (const service of [
      { pinned_message: { message_id: 4 } },
      { message_auto_delete_timer_changed: { message_auto_delete_time: 86400 } },
      { new_chat_members: [{ id: 7 }] },
    ]) {
      expect(parseUpdate(message({ text: undefined, ...service }))).toBeNull();
    }
  });

  it('reads only a private owner callback with a bounded approval token', () => {
    const approvalId = '33333333-3333-4333-8333-333333333333';
    const update = {
      callback_query: {
        id: 'callback-1',
        from: { id: 42 },
        data: `har:a:${approvalId}`,
        message: { message_id: 99, chat: { id: 42, type: 'private' } },
      },
    };
    expect(parseCallbackQuery(update)).toEqual({
      id: 'callback-1',
      approvalId,
      decision: 'approve',
      chatId: 42,
      messageId: 99,
      privateChat: true,
      senderId: 42,
    });
    expect(parseCallbackQuery({
      ...update,
      callback_query: { ...update.callback_query, data: 'har:a:not-a-uuid' },
    })).toBeNull();
    expect(parseCallbackQuery({
      ...update,
      callback_query: { ...update.callback_query, data: `har:x:${approvalId}` },
    })).toBeNull();
  });
});

describe('answering what the agent cannot read', () => {
  it('points photos and files at the app, voice at the keyboard, and the rest at text', () => {
    expect(unreadableReply('photo')).toBe(
      'I can’t open photos or files here yet. Type what you need, or send the file in the Jentera app chat.',
    );
    expect(unreadableReply('document')).toBe(unreadableReply('photo'));
    expect(unreadableReply('voice')).toBe('I can’t listen to voice notes yet. Please type your message.');
    for (const kind of [
      'audio', 'video', 'video_note', 'sticker', 'animation', 'location', 'contact',
      'poll', 'dice', 'story', 'game', 'paid_media',
    ] as const) {
      expect(unreadableReply(kind)).toBe('I can only read text messages for now.');
    }
  });

  it('asks for a caption it could not read to be sent on its own', () => {
    expect(unreadableReply('voice', true)).toBe(
      'I can’t listen to voice notes yet. Send the words you typed as their own message and I’ll answer them.',
    );
    expect(unreadableReply('video', true)).toBe(
      'I can only read text messages for now. Send the words you typed as their own message and I’ll answer them.',
    );
  });

  it('tells the agent what it was not given, and leaves plain text alone', () => {
    expect(withUnseenMediaNote('Record this receipt')).toBe('Record this receipt');
    const noted = withUnseenMediaNote('Record this receipt', 'photo');
    expect(noted.startsWith('Record this receipt\n\n')).toBe(true);
    expect(noted).toMatch(/with a photo attached/);
    expect(noted).toMatch(/not on your filesystem/);
    expect(noted).toMatch(/say you cannot see it/);
    expect(withUnseenMediaNote('Summarise this', 'document')).toMatch(/with a file attached/);
  });
});

describe('webhook registration', () => {
  it('subscribes to messages and inline-keyboard callback queries', async () => {
    const fetch = fetchFake(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    await setWebhook('123456:token', 'https://api.test/hook', 'secret');
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      allowed_updates: ['message', 'callback_query'],
    });
  });
});

describe('automatic reply typing', () => {
  it('refreshes without overlap, stops with the work, and has a hard cap', async () => {
    vi.useFakeTimers();
    const fetch = fetchFake(async () =>
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
    const fetch = fetchFake(async () =>
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
    const fetch = fetchFake(async () =>
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
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42, { messageId: 91 });

    await stream.setStatus('✅ System ready — starting…');

    const editCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/editMessageText'));
    expect(editCalls()).toHaveLength(1);
    expect(JSON.parse(String(editCalls()[0][1]?.body))).toMatchObject({
      chat_id: 42,
      message_id: 91,
      text: '✅ System ready — starting…',
    });
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/sendMessage'))).toBe(false);
  });

  it('publishes immediately, then at the 24-character buffer threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = fetchFake(async () =>
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
    const fetch = fetchFake(async () =>
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
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.setStatus('✅ System ready — starting…');

    const sendCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/sendMessage'));
    expect(sendCalls()).toHaveLength(1);
    const body = JSON.parse(String(sendCalls()[0][1]?.body)) as { text: string };
    expect(body.text).toContain('System ready');
  });

  it('status clears the moment answer text starts streaming', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = fetchFake(async () =>
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
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.push('Started');
    fetch.mockClear();
    await stream.setStatus('⏳ Working… (99s)');

    expect(fetch.mock.calls.some(([url]) => String(url).includes('/editMessageText')))
      .toBe(false);
  });

  it('coalesces rapid status churn but still surfaces the newest step', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 91 } })));
    vi.stubGlobal('fetch', fetch);
    const stream = new TelegramLiveStream('123456789:AAtoken', 42);

    await stream.setStatus('✅ System ready — starting…');
    fetch.mockClear();

    // A burst of distinct statuses inside one cooldown window…
    await stream.setStatus('✅ Runner online — starting agent…');
    await stream.setStatus('✅ Agent engine warm — planning…');
    // …never hits Telegram immediately…
    expect(fetch).not.toHaveBeenCalled();

    // …and the boundary flushes only the newest of the burst.
    await vi.advanceTimersByTimeAsync(500);
    const editCalls = () => fetch.mock.calls.filter(([url]) =>
      String(url).includes('/editMessageText'));
    expect(editCalls()).toHaveLength(1);
    let body = JSON.parse(String(editCalls()[0][1]?.body)) as { text: string };
    expect(body.text).toContain('Agent engine warm');

    // An identical repeat is skipped entirely.
    await stream.setStatus('✅ Agent engine warm — planning…');
    expect(editCalls()).toHaveLength(1);

    // A status outside the cooldown window publishes immediately.
    await vi.advanceTimersByTimeAsync(1_000);
    await stream.setStatus('✅ Agent started — thinking…');
    expect(editCalls()).toHaveLength(2);
    body = JSON.parse(String(editCalls()[1][1]?.body)) as { text: string };
    expect(body.text).toContain('Agent started');
  });
});
