/* ============================================================
   The live bubble lane must survive Telegram's "message is not
   modified" 400.

   Regression for the frozen "⏳ Thinking…" bubble: the
   webhook sends that exact text and persists its message id; the
   queue consumer reattaches to the SAME bubble and its first
   setStatus is the SAME string. Telegram rejects an identical edit
   with 400 "message is not modified" — which used to throw, set
   `available = false` in TelegramLiveStream, and silently kill
   every later status/tool/@step/answer edit for the whole run.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editMessageText, TelegramLiveStream } from '../src/connectors/telegram';

const TOKEN = '123456789:AAtoken';
const CHAT = 42;

let edited: { messageId: unknown; text: unknown }[];
let notModifiedFirst = false;

function telegramStub() {
  edited = [];
  notModifiedFirst = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('editMessageText')) {
        const body = JSON.parse(String(init.body)) as {
          message_id: unknown;
          text: unknown;
        };
        edited.push({ messageId: body.message_id, text: body.text });
        /* Faithful to Bot API: an edit whose text equals the current
           message text is rejected with 400. The first edit after
           reattach is byte-identical to the webhook's bubble. */
        if (notModifiedFirst) {
          return new Response(
            JSON.stringify({ ok: false, description: 'Bad Request: message is not modified' }),
            { status: 400 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      if (String(url).includes('sendChatAction')) {
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      if (String(url).includes('sendMessage')) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }));
      }
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }),
  );
}

const flushCooldown = () => new Promise((resolve) => setTimeout(resolve, 700));

beforeEach(() => {
  telegramStub();
});

afterEach(() => vi.unstubAllGlobals());

describe('TelegramLiveStream reattach to the webhook bubble', () => {
  it('reports the first Telegram-accepted answer edit exactly once', async () => {
    const published = vi.fn();
    const stream = new TelegramLiveStream(TOKEN, CHAT, {
      messageId: 77,
      onFirstTextPublished: published,
    });

    await stream.setStatus('⚡ Preparing a quick reply…');
    expect(published).not.toHaveBeenCalled();

    await stream.push('Here is the answer.');
    await stream.push(' More detail follows.');
    await stream.flush();

    expect(published).toHaveBeenCalledTimes(1);
  });

  it('does not die when the first status equals the bubble text (message is not modified)', async () => {
    notModifiedFirst = true;
    /* Reattach: the stream is constructed with the webhook bubble's id,
       whose text is already "⏳ Thinking…". */
    const stream = new TelegramLiveStream(TOKEN, CHAT, { messageId: 77 });

    /* Identical status — Telegram 400s it. Must be a no-op, not fatal. */
    await stream.setStatus('⏳ Thinking…');

    /* The next, different status is inside the 500ms coalescing window, so
       it flushes on the timer; both edits must land on the same bubble and
       the lane must still be alive. */
    await stream.setStatus('⏳ Working… (5s)');
    await flushCooldown();

    expect(edited.map((e) => e.messageId)).toEqual([77, 77]);
    expect(edited[1].text).toBe('⏳ Working… (5s)');
  });

  it('keeps streaming answer deltas into the same bubble after the identical first edit', async () => {
    notModifiedFirst = true;
    const stream = new TelegramLiveStream(TOKEN, CHAT, { messageId: 77 });

    await stream.setStatus('⏳ Thinking…');

    /* Deltas publish immediately on the answer lane; it must stay alive. */
    await stream.push('Here is the full answer to your question. ');
    await stream.push('Second chunk of the answer.');

    expect(edited.length).toBeGreaterThanOrEqual(2);
    expect(edited[edited.length - 1].messageId).toBe(77);
    expect(String(edited[edited.length - 1].text)).toContain('Here is the full answer');
  });

  it('a genuine edit failure still disables only the live lane', async () => {
    /* Non-not-modified failure (e.g. chat not found) keeps the old
       semantics: cosmetic lane dies, durable reply unaffected. */
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes('editMessageText')) {
          const body = JSON.parse(String(init.body)) as {
            message_id: unknown;
            text: unknown;
          };
          edited.push({ messageId: body.message_id, text: body.text });
        }
        return new Response(
          JSON.stringify({ ok: false, description: 'chat not found' }),
          { status: 400 },
        );
      }),
    );
    const stream = new TelegramLiveStream(TOKEN, CHAT, { messageId: 77 });
    await stream.setStatus('⏳ Working… (1s)');
    await stream.setStatus('⏳ Working… (6s)');
    expect(edited).toHaveLength(1);
  });

  it('hands the bubble to final delivery without a pending status overwriting the answer', async () => {
    const stream = new TelegramLiveStream(TOKEN, CHAT, { messageId: 77 });
    await stream.setStatus('🧠 Deep work started…');
    await stream.setStatus('⏳ Researching…');

    const messageId = stream.handoffMessageId();
    expect(messageId).toBe(77);
    await editMessageText(TOKEN, CHAT, messageId!, 'Here is the final answer.');
    await flushCooldown();

    expect(edited.at(-1)).toEqual({ messageId: 77, text: 'Here is the final answer.' });
    expect(edited.some((entry) => entry.text === '⏳ Researching…')).toBe(false);
  });
});
