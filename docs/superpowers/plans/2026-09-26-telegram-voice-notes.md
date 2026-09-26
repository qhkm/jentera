# Telegram Voice Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A voice note sent to a business's Telegram bot is transcribed, shown back to the owner, and answered like typed text.

**Architecture:** The webhook keeps only the voice note's ids (never bytes) and queues it like a text message. Telegram admission (`handleRuntimeQueueMessage`) hears it first — download with the token the worker already holds, Workers AI Whisper, echo "🎤 …" once — then admits the transcript through the unchanged text path. Anything that cannot be heard gets one reply and no run. Bots whose token lives in the vault keep today's "can't listen yet" reply until the vault gains a file route.

**Tech Stack:** Cloudflare Worker (TypeScript), Workers AI `@cf/openai/whisper-large-v3-turbo` on the existing `AI` binding, Telegram Bot API `getFile`, Neon Postgres (RLS), vitest with a per-run Docker Postgres.

**Spec:** `docs/superpowers/specs/2026-09-24-telegram-media-design.md`, piece 3, voice half only. The spec ordered voice after attachments (pieces 1–2); on 26 September the owner asked for voice first, which the spec allows ("Voice does not depend on 1 or 2 and could ship straight after 0"). Photos and files stay on the spec's order.

## Measurements (26 September, Workers AI via the account API)

Telegram-format notes made with `ffmpeg -c:a libopus -ar 48000 -ac 1 -application voip`:

| Input | Result |
|---|---|
| OGG/Opus as Telegram sends it | Accepted; no transcoding |
| Malay (TTS, 9.5 s) | Word-perfect, "RM30", "8 pagi" |
| Manglish (TTS, 7.4 s) | "to three pm" read as "2-3pm" |
| English (4.2 s) | Word-perfect |
| 4 s silence, `vad_filter` off | "Thank you." |
| 4 s silence, `vad_filter` on | Empty |
| `language: 'ms'` forced | No change; leave detection on |
| 3 min / 9.5 min | 32 s / 79 s, one request each |

Real owner voice notes remain the live check (Task 6).

## Global Constraints

- Model `@cf/openai/whisper-large-v3-turbo`, with `vad_filter: true`, `condition_on_previous_text: false`, an `initial_prompt` naming Malay and English, and no `language`.
- Voice note cap: 10 minutes (`VOICE_MAX_SECONDS = 600`). Telegram's bot download cap: 20 MB (`TELEGRAM_FILE_MAX_BYTES = 20 * 1024 * 1024`).
- The download URL carries the bot token. It is built in one helper, used once, and never logged or put in an error message.
- Audio is not kept anywhere. The transcript is kept as the run's question, like typed text.
- A transcript never approves anything. Approvals stay button callbacks (`parseCallbackQuery`, `har:a:`/`har:d:`).
- The queue message carries ids, not bytes and not the transcript.
- Every step tolerates running twice: the inline slice and the 30 s safety net (`INLINE_SAFETY_NET_SECONDS`) both run admission.
- Stage named paths only; never `git add -A` (shared checkout).

## Review Focus

1. **A voice note with a caption.** The owner should get an answer to both; the admitted text is the transcript, a blank line, then the caption. Test in Task 4.
2. **A long transcript.** A 10-minute note can exceed Telegram's 4096-character message cap; the echo must be truncated, not rejected. Test in Task 3 (`voiceEcho`).
3. **A long note heard twice.** Transcribing a note over about 2.5 minutes outlasts the 30 s safety-net delay, so both paths can hear it; the owner must see one echo, not two. Test in Task 4 (claim denies the second).
4. **A redelivered intake after admission.** The second pass must not transcribe again. Test in Task 4 (AI called once).
5. **Whisper or the download failing for good.** Transient failures throw and the queue retries (8 tries, `wrangler.toml` `max_retries`); after that the intake goes to the dead-letter queue with no reply. Recorded as a follow-up in `docs/todo.md` in Task 5, not built here.

---

### Task 1: Transcribe audio with Whisper

**Files:**
- Create: `worker/src/voice/transcribe.ts`
- Test: `worker/test/voice-transcribe.test.ts`

**Interfaces:**
- Produces: `transcribeVoice(ai: Ai, audio: Uint8Array): Promise<Heard>`, `type Heard = { text: string } | { unintelligible: true }`, `WHISPER_MODEL`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { transcribeVoice, WHISPER_MODEL } from '../src/voice/transcribe';

const ai = (text: unknown) => ({ run: vi.fn(async () => ({ text })) }) as unknown as Ai & { run: ReturnType<typeof vi.fn> };
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);

describe('transcribing a voice note', () => {
  it('sends the audio as sent, with silence filtering and a Malay/English hint', async () => {
    const fake = ai(' Tolong ingatkan saya esok pukul 8 pagi. ');
    expect(await transcribeVoice(fake, OGG)).toEqual({ text: 'Tolong ingatkan saya esok pukul 8 pagi.' });
    const [model, input] = fake.run.mock.calls[0] as [string, Record<string, unknown>];
    expect(model).toBe(WHISPER_MODEL);
    expect(input).toMatchObject({ audio: btoa('OggS\x01\x02\x03'), vad_filter: true, condition_on_previous_text: false });
    expect(String(input.initial_prompt)).toMatch(/Melayu/);
    expect(input).not.toHaveProperty('language');
  });

  /* Measured 26 Sep: four seconds of silence read "Thank you." with VAD off. */
  it.each(['', '   ', 'Thank you.', 'Terima kasih.', 'Thanks for watching!', null])(
    'calls %j unintelligible', async (text) => {
      expect(await transcribeVoice(ai(text), OGG)).toEqual({ unintelligible: true });
    });

  it('encodes audio larger than one call stack of arguments', async () => {
    const big = new Uint8Array(200_000).fill(65);
    const fake = ai('ok');
    await transcribeVoice(fake, big);
    const [, input] = fake.run.mock.calls[0] as [string, { audio: string }];
    expect(atob(input.audio).length).toBe(200_000);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd worker && pnpm vitest run test/voice-transcribe.test.ts`
Expected: FAIL, cannot find module `../src/voice/transcribe`.

- [ ] **Step 3: Implement**

```ts
/**
 * Voice notes, heard in the worker. Hermes transcribes only on its own
 * Telegram gateway, which a Jentera bot does not use, so the audio is turned
 * into text before the agent is asked. The audio is not kept.
 * Settings measured on 26 September (plans/2026-09-26-telegram-voice-notes.md).
 */
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

const INITIAL_PROMPT =
  'Mesej suara pemilik perniagaan di Malaysia, dalam Bahasa Melayu, English atau campuran. ' +
  'A Malaysian business owner voice note in Malay, English or both.';

/** What Whisper says over silence or noise. A note that is only one of these
    is treated as unheard: an owner asked to type it loses a few seconds,
    an agent acting on "Thank you." answers a message nobody sent. */
const STOCK_PHRASES = new Set([
  'thank you', 'thanks', 'thank you for watching', 'thanks for watching',
  'terima kasih', 'terima kasih kerana menonton', 'you', 'bye',
]);

export type Heard = { text: string } | { unintelligible: true };

export async function transcribeVoice(ai: Ai, audio: Uint8Array): Promise<Heard> {
  const result = await (ai.run as (model: string, input: Record<string, unknown>) => Promise<unknown>)(
    WHISPER_MODEL,
    {
      audio: base64(audio),
      vad_filter: true,
      condition_on_previous_text: false,
      initial_prompt: INITIAL_PROMPT,
    },
  ) as { text?: unknown } | null;
  const text = typeof result?.text === 'string' ? result.text.trim() : '';
  const bare = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  if (!bare || STOCK_PHRASES.has(bare)) return { unintelligible: true };
  return { text };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd worker && pnpm vitest run test/voice-transcribe.test.ts && pnpm typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add worker/src/voice/transcribe.ts worker/test/voice-transcribe.test.ts
git commit -m "feat(voice): transcribe a voice note with Workers AI Whisper"
```

---

### Task 2: Download a Telegram file without leaking the token

**Files:**
- Modify: `worker/src/connectors/telegram.ts` (beside `sendMessage`, around line 133)
- Test: `worker/test/telegram-file.test.ts`

**Interfaces:**
- Produces: `downloadTelegramFile(token: string, fileId: string, maxBytes?: number): Promise<Uint8Array>`, `class TelegramFileTooLarge extends Error`, `TELEGRAM_FILE_MAX_BYTES`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTelegramFile, TelegramFileTooLarge } from '../src/connectors/telegram';

const TOKEN = '123456789:AAsecret';
afterEach(() => vi.unstubAllGlobals());

function telegram(meta: unknown, file: Response | Error) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/getFile')) return new Response(JSON.stringify(meta));
    if (file instanceof Error) throw file;
    return file;
  }));
  return calls;
}

describe('downloading a file the owner sent', () => {
  it('asks Telegram where the file is, then fetches its bytes', async () => {
    const calls = telegram({ ok: true, result: { file_path: 'voice/file_7.oga', file_size: 3 } },
      new Response(new Uint8Array([1, 2, 3])));
    expect(await downloadTelegramFile(TOKEN, 'AwAC')).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([
      `https://api.telegram.org/bot${TOKEN}/getFile`,
      `https://api.telegram.org/file/bot${TOKEN}/voice/file_7.oga`,
    ]);
  });

  it('refuses a file over the limit before downloading it', async () => {
    const calls = telegram({ ok: true, result: { file_path: 'x', file_size: 21 } }, new Response('never'));
    await expect(downloadTelegramFile(TOKEN, 'AwAC', 20)).rejects.toBeInstanceOf(TelegramFileTooLarge);
    expect(calls).toHaveLength(1);
  });

  /* The file URL is the token. A failed fetch must not carry it into a log. */
  it.each([
    [{ ok: false, description: `bad token ${TOKEN}` }, new Response('x')],
    [{ ok: true, result: { file_path: 'x' } }, new Error(`connect failed https://api.telegram.org/file/bot${TOKEN}/x`)],
    [{ ok: true, result: { file_path: 'x' } }, new Response('gone', { status: 404 })],
  ])('never puts the token in an error', async (meta, file) => {
    telegram(meta, file);
    const error = await downloadTelegramFile(TOKEN, 'AwAC').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('AAsecret');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd worker && pnpm vitest run test/telegram-file.test.ts`
Expected: FAIL, `downloadTelegramFile` is not exported.

- [ ] **Step 3: Implement** (in `worker/src/connectors/telegram.ts`, after `sendMessage`)

```ts
/** Telegram will not hand a bot a file larger than this. */
export const TELEGRAM_FILE_MAX_BYTES = 20 * 1024 * 1024;

export class TelegramFileTooLarge extends Error {}

/** The bytes of a file the owner sent, for a bot whose token the worker holds.
    A file URL is `…/file/bot<token>/<path>`: it is built here, used once and
    never logged, and no error from here carries it. A vault-held bot cannot
    use this; the vault has no file route yet. `getFile` is asked each time
    because Telegram keeps a path valid for an hour only. */
export async function downloadTelegramFile(
  token: string,
  fileId: string,
  maxBytes = TELEGRAM_FILE_MAX_BYTES,
): Promise<Uint8Array> {
  const described = await fetch(`${API}/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15_000),
  }).then((res) => res.json(), () => null).catch(() => null) as {
    ok?: boolean;
    result?: { file_path?: unknown; file_size?: unknown };
  } | null;
  const path = described?.ok ? described.result?.file_path : undefined;
  if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]{1,256}$/.test(path)) {
    throw new Error('Telegram would not describe that file');
  }
  const size = Number(described?.result?.file_size ?? 0);
  if (size > maxBytes) throw new TelegramFileTooLarge('that file is over the download limit');
  const file = await fetch(`${API}/file/bot${token}/${path}`, { signal: AbortSignal.timeout(60_000) })
    .catch(() => null);
  if (!file?.ok) throw new Error('Telegram would not send that file');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new TelegramFileTooLarge('that file is over the download limit');
  return bytes;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd worker && pnpm vitest run test/telegram-file.test.ts && pnpm typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add worker/src/connectors/telegram.ts worker/test/telegram-file.test.ts
git commit -m "feat(telegram): download a file the owner sent, keeping the token out of errors"
```

---

### Task 3: Read a voice note at the webhook and queue its ids

**Files:**
- Modify: `worker/src/connectors/telegram.ts` (`IncomingMessage` ~line 628, `parseUpdate` ~line 691, new helpers after `unreadableReply` ~line 748)
- Modify: `worker/src/telegram-delivery.ts:17-26` (`TelegramIncoming`)
- Modify: `worker/src/routes/connect.ts` (before the `if (incoming.unseen)` block ~line 655; `handleIncoming` message ~line 827)
- Modify: `worker/src/runtime/consumer.ts` (`TelegramIntakeQueueMessage.incoming` ~line 260; `validTelegramIntake` ~line 2938)
- Test: `worker/test/webhook.test.ts` (parsing), `worker/test/routes.test.ts` (webhook route, beside "answers a photo, voice note or sticker it cannot read" ~line 1226)

**Interfaces:**
- Consumes: `TELEGRAM_FILE_MAX_BYTES` (Task 2), `isVaultTelegramCredential` (`worker/src/vault/telegram.ts`), `runtimeExecutionEnabled` (already imported in `connect.ts`).
- Produces: `interface TelegramVoice { fileId: string; fileUniqueId: string; durationS: number; size?: number }`; `IncomingMessage.voice?: TelegramVoice`; `TelegramIncoming.voice?: TelegramVoice`; `TelegramIntakeQueueMessage['incoming'].voice?: TelegramVoice`; `VOICE_MAX_SECONDS`; `VOICE_REPLIES = { tooLong, unintelligible }`; `voiceRefusal(voice: TelegramVoice, credential: TelegramCredential): string | null`; `voiceEcho(transcript: string): string`.

- [ ] **Step 1: Write the failing tests**

In `worker/test/webhook.test.ts`, extend the import from `../src/connectors/telegram` with `VOICE_REPLIES, voiceEcho, voiceRefusal`, and add to `describe('reading an update', …)`:

```ts
  it('reads a voice note as its ids and length, not as unseen', () => {
    expect(parseUpdate(message({
      text: undefined,
      voice: { file_id: 'AwAC', file_unique_id: 'AgAD', duration: 4, file_size: 9000, mime_type: 'audio/ogg' },
    }))).toMatchObject({
      text: '',
      voice: { fileId: 'AwAC', fileUniqueId: 'AgAD', durationS: 4, size: 9000 },
    });
    expect(parseUpdate(message({
      text: undefined, caption: 'for the Friday order',
      voice: { file_id: 'AwAC', file_unique_id: 'AgAD', duration: 4 },
    }))).toMatchObject({ text: 'for the Friday order', voice: { fileId: 'AwAC' } });
    expect(parseUpdate(message({
      text: undefined, voice: { file_id: 'AwAC', file_unique_id: 'AgAD', duration: 4 },
    }))).not.toHaveProperty('unseen');
  });
```

and a new block:

```ts
describe('deciding whether a voice note can be heard', () => {
  const voice = { fileId: 'AwAC', fileUniqueId: 'AgAD', durationS: 30, size: 60_000 };
  it('hears a bot the worker holds the token for', () => {
    expect(voiceRefusal(voice, '123:AAtoken')).toBeNull();
  });
  it('says a note over ten minutes or twenty megabytes is too long', () => {
    expect(voiceRefusal({ ...voice, durationS: 601 }, '123:AAtoken')).toBe(VOICE_REPLIES.tooLong);
    expect(voiceRefusal({ ...voice, size: 21 * 1024 * 1024 }, '123:AAtoken')).toBe(VOICE_REPLIES.tooLong);
  });
  it('keeps the old answer for a bot whose token is in the vault', () => {
    const vault = { kind: 'vault' as const, env, businessId: A, secretId: 's' };
    expect(voiceRefusal(voice, vault)).toBe(unreadableReply('voice'));
  });
  it('echoes a transcript within Telegram’s message limit', () => {
    expect(voiceEcho('Tolong ingatkan saya.')).toBe('🎤 “Tolong ingatkan saya.”');
    const echo = voiceEcho('a'.repeat(9000));
    expect(echo.length).toBeLessThan(4096);
    expect(echo.endsWith('…”')).toBe(true);
  });
});
```

In `worker/test/routes.test.ts`, add after "answers a photo, voice note or sticker it cannot read":

```ts
  it('queues a voice note by its ids for transcription, and answers one that is too long', async () => {
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    const queued: unknown[] = [];
    env = automaticRuntimeEnv(async (message) => { queued.push(message); });
    const owner = { chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Owner' } };

    fetch.mockClear();
    expect((await telegramUpdate(paired.connectionId, paired.secret, {
      ...owner, message_id: 50, voice: { file_id: 'AwAC', file_unique_id: 'AgAD', duration: 4, file_size: 9000 },
    })).status).toBe(200);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      kind: 'telegram_intake',
      incoming: { chatId: 42, messageId: 50, text: '', voice: { fileId: 'AwAC', fileUniqueId: 'AgAD', durationS: 4 } },
    });
    expect(JSON.stringify(queued[0])).not.toMatch(/AAtoken|file_path/);
    expect(fetch.mock.calls.filter(([input]) => String(input).includes('/sendMessage'))).toHaveLength(0);

    fetch.mockClear();
    await telegramUpdate(paired.connectionId, paired.secret, {
      ...owner, message_id: 51, voice: { file_id: 'AwAD', file_unique_id: 'AgAE', duration: 601 },
    });
    expect(queued).toHaveLength(1);
    const sends = fetch.mock.calls.filter(([input]) => String(input).includes('/sendMessage'));
    expect(JSON.parse(String(sends[0][1]?.body))).toMatchObject({ chat_id: 42, text: VOICE_REPLIES.tooLong });
  });
```

(import `VOICE_REPLIES` from `../src/connectors/telegram` in `routes.test.ts`). In the existing "answers a photo, voice note or sticker it cannot read" test, the voice case (`{ message_id: 41, voice: { file_id: 'v', duration: 3 } }`) has no `file_unique_id`, so it stays a stopgap reply; leave it and rename the test to "answers a photo, a malformed voice note or a sticker it cannot read".

- [ ] **Step 2: Run them to see them fail**

Run: `cd worker && pnpm vitest run test/webhook.test.ts test/routes.test.ts -t "voice"`
Expected: FAIL: `voiceRefusal` not exported; the voice note gets the stopgap reply instead of queuing.

- [ ] **Step 3: Implement**

`worker/src/connectors/telegram.ts` — add the type and constants near `IncomingMessage`:

```ts
export interface TelegramVoice {
  fileId: string;
  fileUniqueId: string;
  durationS: number;
  size?: number;
}

/** Longer than this is refused at the webhook. Measured 26 Sep: a 9.5-minute
    note transcribes in one Whisper request in about 80 s. */
export const VOICE_MAX_SECONDS = 600;

export const VOICE_REPLIES = {
  tooLong: 'That voice note is longer than 10 minutes. Send a shorter one, or type your message.',
  unintelligible: 'I couldn’t make out that voice note. Please type your message.',
} as const;
```

and to `IncomingMessage`: `voice?: TelegramVoice;` with the comment `/** A voice note to transcribe; \`text\` is then its caption, or empty. */`.

In `parseUpdate`, after the `text` early return and before `const unseen = unseenKind(msg);`:

```ts
  const voice = msg.voice as { file_id?: unknown; file_unique_id?: unknown; duration?: unknown; file_size?: unknown } | undefined;
  if (voice && typeof voice.file_id === 'string' && voice.file_id.length <= 256 &&
      typeof voice.file_unique_id === 'string' && voice.file_unique_id.length <= 128 &&
      Number.isSafeInteger(voice.duration) && (voice.duration as number) >= 0) {
    const caption = typeof msg.caption === 'string' ? msg.caption.trim().slice(0, 1024) : '';
    return {
      ...base,
      text: caption,
      voice: {
        fileId: voice.file_id,
        fileUniqueId: voice.file_unique_id,
        durationS: voice.duration as number,
        ...(Number.isSafeInteger(voice.file_size) ? { size: voice.file_size as number } : {}),
      },
    };
  }
```

After `unreadableReply`:

```ts
/** Why a voice note will not be heard, or null when it will. A vault-held
    bot cannot download yet (the vault has no file route), so it keeps the
    stopgap answer rather than failing later in admission. */
export function voiceRefusal(voice: TelegramVoice, credential: TelegramCredential): string | null {
  if (isVaultTelegramCredential(credential)) return unreadableReply('voice');
  if (voice.durationS > VOICE_MAX_SECONDS || (voice.size ?? 0) > TELEGRAM_FILE_MAX_BYTES) {
    return VOICE_REPLIES.tooLong;
  }
  return null;
}

/** The transcript shown back before the answer, so a mishearing is caught
    before it is acted on. Telegram caps a message at 4096 characters. */
export function voiceEcho(transcript: string): string {
  const shown = transcript.length > 3500 ? `${transcript.slice(0, 3500)}…` : transcript;
  return `🎤 “${shown}”`;
}
```

`worker/src/telegram-delivery.ts` — add to `TelegramIncoming`: `voice?: TelegramVoice;` (import the type from `./connectors/telegram`).

`worker/src/routes/connect.ts` — immediately before the `if (incoming.unseen) {` block:

```ts
  /* A voice note is heard in admission. What cannot be heard is answered here,
     after pairing and before admission, so it never costs a paid run. */
  if (incoming.voice) {
    const refusal = runtimeExecutionEnabled(env)
      ? voiceRefusal(incoming.voice, token)
      : unreadableReply('voice');
    if (refusal) {
      await sendMessage(token, incoming.chatId, refusal).catch(() => {});
      return ok;
    }
  }
```

(import `voiceRefusal`), and in `handleIncoming`'s `message` object add `...(incoming.voice ? { voice: incoming.voice } : {}),` after the `unseen` line.

`worker/src/runtime/consumer.ts` — in `TelegramIntakeQueueMessage['incoming']` add:

```ts
    /** A voice note to hear before admission: ids only, never bytes. */
    voice?: { fileId: string; fileUniqueId: string; durationS: number; size?: number };
```

and in `validTelegramIntake` replace `typeof incoming.text === 'string' && incoming.text.trim().length > 0 &&` with:

```ts
    typeof incoming.text === 'string' &&
    (incoming.text.trim().length > 0 || validVoice(incoming.voice)) &&
    (incoming.voice === undefined || validVoice(incoming.voice)) &&
```

and add below it:

```ts
function validVoice(voice: unknown): boolean {
  const v = voice as { fileId?: unknown; fileUniqueId?: unknown; durationS?: unknown; size?: unknown } | undefined;
  return Boolean(v) && typeof v!.fileId === 'string' && v!.fileId.length > 0 && v!.fileId.length <= 256 &&
    typeof v!.fileUniqueId === 'string' && v!.fileUniqueId.length > 0 && v!.fileUniqueId.length <= 128 &&
    Number.isSafeInteger(v!.durationS) && (v!.durationS as number) >= 0 && (v!.durationS as number) <= 600 &&
    (v!.size === undefined || Number.isSafeInteger(v!.size));
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd worker && pnpm vitest run test/webhook.test.ts test/routes.test.ts && pnpm typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add worker/src/connectors/telegram.ts worker/src/telegram-delivery.ts worker/src/routes/connect.ts worker/src/runtime/consumer.ts worker/test/webhook.test.ts worker/test/routes.test.ts
git commit -m "feat(telegram): queue a voice note by its ids instead of refusing it"
```

---

### Task 4: Hear the voice note in admission and answer the transcript

**Files:**
- Create: `worker/src/runtime/telegram-voice.ts`
- Modify: `worker/src/request-guard.ts` (after `claimTelegramAlbumReply`, ~line 97)
- Modify: `worker/src/runtime/consumer.ts` (`handleRuntimeQueueMessage` ~line 684-700; `prepareHermesAgent` input ~line 748; `triggerRef` ~line 762)
- Test: `worker/test/telegram-voice.test.ts`

**Interfaces:**
- Consumes: `transcribeVoice`, `Heard` (Task 1); `downloadTelegramFile`, `TelegramFileTooLarge` (Task 2); `voiceEcho`, `VOICE_REPLIES`, `unreadableReply` (Task 3); `runtimeTaskByDedupeKey` (`worker/src/runtime/tasks.ts`); `useTelegramCredential` (`worker/src/connections.ts`); `isVaultTelegramCredential` (`worker/src/vault/telegram.ts`); `sendMessage`.
- Produces: `hearTelegramVoice(env: Env, message: TelegramIntakeQueueMessage, dedupeKey: string): Promise<VoiceIntake>`; `type VoiceIntake = { kind: 'heard'; message: TelegramIntakeQueueMessage } | { kind: 'admitted' } | { kind: 'answered' }`; `withVoiceNote(text: string, voice?: unknown): string`; `claimTelegramVoiceReply(env, connectionId, chatId, messageId): Promise<boolean>`.

- [ ] **Step 1: Write the failing test** (`worker/test/telegram-voice.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRuntimeQueueMessage, LocalRuntimeProvider } from '../src/runtime';
import { enqueueRuntimeTask, leaseRuntimeTask } from '../src/runtime/tasks';
import { saveConnection } from '../src/connections';
import { markRuntimeReady } from '../src/agent-runtime';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { VOICE_REPLIES } from '../src/connectors/telegram';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let sent: string[];
let transcribe: ReturnType<typeof vi.fn>;

async function setup(transcript: string) {
  transcribe = vi.fn(async () => ({ text: transcript }));
  const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1', AISAR_MODEL_NAME: 'MiniMax-M3' });
  env.AI = { run: transcribe } as unknown as typeof env.AI;
  const provider = new LocalRuntimeProvider();
  await ensureProviderRuntime(env, A, { provider, runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64) });
  await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
  const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
    insert into app_user (email, email_verified) values ('voice-owner@example.com', true) returning id`);
  const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
    connector: 'telegram', method: 'bot_token', externalId: '123456789',
    displayName: '@voice_bot', secret: '123456789:AAtoken', connectedBy: owner.id,
  }));
  /* Hold the runtime busy so admission commits and the task waits: this test
     is about what admission records, not about the run. */
  const active = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, { kind: 'provision', dedupeKey: 'voice:active' }));
  await asTenant(A, (tx) => leaseRuntimeTask(tx, A, active.id, 'active-owner', 300));
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/getFile')) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/file_1.oga', file_size: 4 } }));
    }
    if (url.includes('/file/bot')) return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
    if (url.endsWith('/sendMessage')) sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 90 } }));
  }));
  const intake = (messageId: number, caption = '') => ({
    version: 2 as const, kind: 'telegram_intake' as const, businessId: A, connectionId: connection.id,
    requestedAtMs: Date.now(),
    incoming: { chatId: 42, messageId, from: 'Owner', text: caption, privateChat: true as const,
      voice: { fileId: 'AwAC', fileUniqueId: `AgAD${messageId}`, durationS: 4 } },
  });
  return { env, provider, intake };
}

beforeEach(() => truncateAll());
afterEach(() => vi.unstubAllGlobals());

describe('a Telegram voice note', () => {
  it('runs as its transcript, shown back once, and is heard once however often it arrives', async () => {
    const { env, provider, intake } = await setup('Tolong ingatkan saya esok pukul 8 pagi.');
    await handleRuntimeQueueMessage(env, intake(7, 'untuk sarapan'), { provider });
    await handleRuntimeQueueMessage(env, intake(7, 'untuk sarapan'), { provider });

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(sent.filter((text) => text.startsWith('🎤'))).toEqual(['🎤 “Tolong ingatkan saya esok pukul 8 pagi.”']);
    const runs = await asOwner((sql) => sql<{ ref: Record<string, unknown>; input: string }[]>`
      select r.trigger_ref as ref, t.payload->>'input' as input
        from run r join runtime_task t on t.run_id = r.id where r.business_id = ${A} and t.kind = 'run'`);
    expect(runs).toHaveLength(1);
    expect(runs[0].ref).toMatchObject({
      question: 'Tolong ingatkan saya esok pukul 8 pagi.\n\nuntuk sarapan', input: 'voice', durationS: 4,
    });
    expect(runs[0].input).toMatch(/automatic transcript/);
  });

  it('asks the owner to type a note it could not make out, and starts no run', async () => {
    const { env, provider, intake } = await setup('Thank you.');
    await expect(handleRuntimeQueueMessage(env, intake(8), { provider }))
      .resolves.toMatchObject({ action: 'ack' });
    expect(sent).toEqual([VOICE_REPLIES.unintelligible]);
    expect(await asOwner((sql) => sql`select id from run where business_id = ${A}`)).toHaveLength(0);
  });

  /* Approvals are buttons. Words that say "approve" are an ordinary request. */
  it('approves nothing on a transcript that says approve', async () => {
    const { env, provider, intake } = await setup('Approve it. Yes, approve everything.');
    await asOwner((sql) => sql`
      insert into approval (business_id, connector, op, payload, risk, status)
      values (${A}, 'google', 'create_event', '{}'::jsonb, 'medium', 'pending')`);
    await handleRuntimeQueueMessage(env, intake(9), { provider });
    const [row] = await asOwner((sql) => sql<{ status: string }[]>`select status from approval where business_id = ${A}`);
    expect(row.status).toBe('pending');
  });
});
```

(If the `approval` insert fails on a missing NOT NULL column, copy the insert from the nearest `insert into approval` in `worker/test/` — `grep -rn "insert into approval" worker/test`.)

The harness's `TELEGRAM_ALBUM_REPLY` always succeeds, so the "echo once" claim needs its own test with a limiter that allows only the first call. Add to `worker/test/telegram-voice.test.ts`:

```ts
  it('shows the transcript once when two paths hear the same note', async () => {
    const { env, provider, intake } = await setup('Semak invois Kedai Seri Murni.');
    let first = true;
    env.TELEGRAM_ALBUM_REPLY = { limit: async () => { const ok = first; first = false; return { success: ok }; } } as typeof env.TELEGRAM_ALBUM_REPLY;
    /* Both paths get past the "already admitted" check before either commits. */
    await Promise.all([
      handleRuntimeQueueMessage(env, intake(10), { provider }),
      handleRuntimeQueueMessage(env, intake(10), { provider }),
    ]);
    expect(sent.filter((text) => text.startsWith('🎤'))).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd worker && pnpm vitest run test/telegram-voice.test.ts`
Expected: FAIL: the intake is admitted with empty text and no transcript (or `ack missing`).

- [ ] **Step 3: Implement**

`worker/src/request-guard.ts`, after `claimTelegramAlbumReply`:

```ts
/** Whether this voice note may speak: its echo or its one-line reply. The
    inline slice and the queued safety net can both hear a note long enough to
    outlast the 30 s delay between them; one of them answers. Shares the album
    limiter (one per key per 60 s) under its own key prefix. Fails open. */
export async function claimTelegramVoiceReply(
  env: Env,
  connectionId: string,
  chatId: number,
  messageId: number,
): Promise<boolean> {
  try {
    const key = await opaqueKey(env, `telegram-voice:${connectionId}:${chatId}:${messageId}`);
    return (await env.TELEGRAM_ALBUM_REPLY.limit({ key })).success;
  } catch {
    return true;
  }
}
```

`worker/src/runtime/telegram-voice.ts`:

```ts
/**
 * A Telegram voice note, heard before admission. The audio is fetched with the
 * token the worker already holds, transcribed, and dropped; the transcript is
 * then admitted exactly like typed text. Spec:
 * docs/superpowers/specs/2026-09-24-telegram-media-design.md (piece 3, voice).
 */
import { withTenant } from '../db';
import type { Env } from '../env';
import { useTelegramCredential } from '../connections';
import {
  downloadTelegramFile, sendMessage, TelegramFileTooLarge, unreadableReply, VOICE_REPLIES, voiceEcho,
} from '../connectors/telegram';
import { claimTelegramVoiceReply } from '../request-guard';
import { isVaultTelegramCredential, type TelegramCredential } from '../vault/telegram';
import { transcribeVoice } from '../voice/transcribe';
import type { TelegramIntakeQueueMessage } from './consumer';
import { runtimeTaskByDedupeKey } from './tasks';

export type VoiceIntake =
  | { kind: 'heard'; message: TelegramIntakeQueueMessage }
  | { kind: 'admitted' }
  | { kind: 'answered' };

export async function hearTelegramVoice(
  env: Env,
  message: TelegramIntakeQueueMessage,
  dedupeKey: string,
): Promise<VoiceIntake> {
  const { businessId, connectionId, incoming } = message;
  const voice = incoming.voice!;
  /* A redelivery, or the safety net after the inline slice: admission will
     find the task. Hearing it again would only echo it again. */
  const existing = await withTenant(env, businessId, (tx) => runtimeTaskByDedupeKey(tx, businessId, dedupeKey));
  if (existing) return { kind: 'admitted' };

  const token: TelegramCredential = await withTenant(env, businessId, (tx) =>
    useTelegramCredential(env, tx, businessId, connectionId));
  const say = async (text: string) => {
    if (await claimTelegramVoiceReply(env, connectionId, incoming.chatId, incoming.messageId)) {
      await sendMessage(token, incoming.chatId, text).catch(() => {});
    }
  };
  /* The webhook refuses vault-held bots; this is for an intake queued before
     a bot moved into the vault. */
  if (isVaultTelegramCredential(token)) {
    await say(unreadableReply('voice'));
    return { kind: 'answered' };
  }

  let audio: Uint8Array;
  try {
    audio = await downloadTelegramFile(token, voice.fileId);
  } catch (error) {
    if (error instanceof TelegramFileTooLarge) {
      await say(VOICE_REPLIES.tooLong);
      return { kind: 'answered' };
    }
    throw error; // transient: the queue tries again
  }
  const heard = await transcribeVoice(env.AI, audio);
  if ('unintelligible' in heard) {
    await say(VOICE_REPLIES.unintelligible);
    return { kind: 'answered' };
  }
  await say(voiceEcho(heard.text));
  const caption = incoming.text.trim();
  return {
    kind: 'heard',
    message: { ...message, incoming: { ...incoming, text: caption ? `${heard.text}\n\n${caption}` : heard.text } },
  };
}

/** What the agent is told about a transcript: the words may be misheard. */
export function withVoiceNote(text: string, voice?: unknown): string {
  if (!voice) return text;
  return `${text}\n\nThe owner sent this as a voice note; the text above is an automatic transcript. ` +
    'If a word or number looks misheard, ask rather than guess.';
}
```

`worker/src/runtime/consumer.ts`, in `handleRuntimeQueueMessage` — move the `dedupeKey` line above this block and add after `telegramLatency('queue_received', …)`:

```ts
  if (message.incoming.voice) {
    const heard = await hearTelegramVoice(env, message, dedupeKey);
    if (heard.kind === 'answered') return { action: 'ack', reason: 'completed' };
    if (heard.kind === 'heard') message = heard.message;
    telegramLatency('voice_heard', message.requestedAtMs, { outcome: heard.kind });
  }
```

Change the `prepareHermesAgent` first argument to:

```ts
        withUnseenMediaNote(
          withVoiceNote(withoutModeCommand(message.incoming.text), message.incoming.voice),
          message.incoming.unseen,
        ),
```

and extend `triggerRef` after `sessionId: telegramSessionId,`:

```ts
          ...(message.incoming.voice ? { input: 'voice', durationS: message.incoming.voice.durationS } : {}),
```

Import `hearTelegramVoice`, `withVoiceNote` from `./telegram-voice`. `message` is a parameter; reassigning it is allowed. If `runtimeTaskByDedupeKey` lives elsewhere, import it from where `consumer.ts` already does.

- [ ] **Step 4: Run it to see it pass**

Run: `cd worker && pnpm vitest run test/telegram-voice.test.ts test/runtime-consumer.test.ts test/routes.test.ts && pnpm typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add worker/src/runtime/telegram-voice.ts worker/src/request-guard.ts worker/src/runtime/consumer.ts worker/test/telegram-voice.test.ts
git commit -m "feat(telegram): hear a voice note and answer its transcript"
```

---

### Task 5: Say so in the privacy notice, and record what is left

**Files:**
- Modify: `app/src/routes/Privacy.tsx` (section 5 English ~line 47-51; its Malay twin, the section whose title starts `5.` in the BM list)
- Modify: `docs/todo.md` (the "Telegram voice notes are not understood" row under "Gaps in what is live")
- Modify: `docs/architecture.md` (where Workers AI's `toMarkdown` is described, add the Whisper call)
- Test: `app/src/routes/__tests__/privacy.test.tsx`

- [ ] **Step 1: Write the failing test** (append inside `describe('privacy notice', …)`)

```tsx
  it('says voice notes are transcribed by Cloudflare Workers AI and the audio is not kept', () => {
    const { container } = mount();
    expect(container.textContent).toMatch(/voice notes? .*Cloudflare Workers AI/i);
    expect(container.textContent).toMatch(/audio is not kept/i);
  });
```

(If the helper is named differently in that file, use it; it renders `<MemoryRouter><Privacy /></MemoryRouter>`. For the Malay page, add the same assertions against the BM render the file already tests, matching `/nota suara/i` and `/audio tidak disimpan/i`.)

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && pnpm vitest run src/routes/__tests__/privacy.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add after the paragraph that begins "The document-ingestion feature processes…" in section 5 (English):

```tsx
      <p>Voice notes you send to your business’s Telegram bot are transcribed by Cloudflare Workers AI so Jentera can answer them. The audio is not kept; the transcript is kept in your history like a typed message.</p>
```

and in the Malay section 5:

```tsx
      <p>Nota suara yang anda hantar kepada bot Telegram perniagaan anda ditranskripsikan oleh Cloudflare Workers AI supaya Jentera boleh menjawabnya. Audio tidak disimpan; transkripnya disimpan dalam sejarah anda seperti mesej yang ditaip.</p>
```

In `docs/todo.md`, replace the "Telegram voice notes are not understood" row's Why with: "Shipped 26 Sep for bots whose token the worker holds (5 of 6 connected): transcribed with Whisper on Workers AI, echoed, answered as text. A vault-held bot still gets the stopgap reply until `aisar-vault` gains `POST /v1/telegram/<secretId>/file`. An intake whose download or transcription keeps failing goes to the DLQ after 8 tries with no reply." and its Done when with: "Five real voice notes in BM and Manglish are heard and answered on a sprite; the vault route ships and the vault-held bot is heard too; the app composer gets a mic." Add under "Proposed, not started": "Move pre-vault Telegram bots into the vault (5 of 6 connected on 26 Sep)."

In `docs/architecture.md`, beside the Workers AI `toMarkdown` mention, add: "and `@cf/openai/whisper-large-v3-turbo` for Telegram voice notes (`worker/src/voice/transcribe.ts`; audio not kept)."

- [ ] **Step 4: Run it to see it pass**

Run: `cd app && pnpm vitest run src/routes/__tests__/privacy.test.tsx src/i18n/__tests__/pages-parity.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/routes/Privacy.tsx app/src/routes/__tests__/privacy.test.tsx docs/todo.md docs/architecture.md
git commit -m "docs: say voice notes are transcribed and the audio is not kept"
```

---

### Task 6: Ship and hear real voice notes

- [ ] **Step 1:** Full suites: `cd worker && pnpm test` (check the log header reads `aisar-worker`), `cd app && pnpm vitest run` (re-run any failing file alone before blaming the diff). Both typechecks.
- [ ] **Step 2:** `git fetch`; `git log main..origin/main` empty; `git log origin/main..main` shows only these commits; push.
- [ ] **Step 3:** Deploy the app first (privacy notice): `./deploy.sh "…"` from the real checkout with a clean `git status`.
- [ ] **Step 4:** Deploy the Worker: `cd worker && pnpm run deploy`. Confirm the live bundle holds the change: download `workers/scripts/aisar-api/content/v2` and `grep -c -a "whisper-large-v3-turbo"` (expect ≥ 1) and `grep -c -a "automatic transcript"`.
- [ ] **Step 5:** Live check with the owner, on the Kitakod bot: five real voice notes in BM and Manglish, one silent note, one over ten minutes if practical. For each: the 🎤 echo arrives before the answer; `select trigger_ref->>'input', trigger_ref->>'question' from run where business_id = '4e8c2593-2af2-494f-b157-fec0295a50b5' order by created_at desc limit 7` shows `voice` and the transcript; the silent one gets the "couldn't make out" reply and no run.
