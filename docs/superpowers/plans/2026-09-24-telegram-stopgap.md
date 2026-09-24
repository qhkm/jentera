# Telegram Stopgap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A photo, file, voice note or sticker sent to a Jentera bot gets a one-line honest reply instead of silence, and a captioned photo or file runs as its caption with the agent told it was not given the attachment.

**Architecture:** `parseUpdate` stops returning null for media: it returns the message with `unseen` set to the kind of content and `text` set to the caption (photos and files only) or empty. The webhook answers empty-text messages from the paired owner with a canned reply and starts no run. A captioned photo or file flows through the existing intake unchanged except for one optional queue field, which the consumer turns into a note appended to the agent's input, never to the stored question.

**Tech Stack:** TypeScript on Cloudflare Workers, vitest with a throwaway Postgres in Docker.

**Spec:** `docs/superpowers/specs/2026-09-24-telegram-media-design.md`, section "Piece 0: the stopgap". Read it before starting.

## Global Constraints

- **Work in a worktree, not the shared checkout.** `worker/src/runtime/consumer.ts` and `worker/test/runtime-consumer.test.ts` carry another session's uncommitted edits in `~/ios/aisar-site`, and more may appear. Task 1 creates the worktree; every path below is relative to it.
- **`worker/` and `docs/` only.** No `app/`, `runner/`, `mobile/`. No migration. No runtime release: nothing here reaches a sprite.
- TypeScript, two-space indent, semicolons, single quotes, camelCase. Import through existing import blocks; add names, do not add new import statements from a module already imported.
- User-facing copy is English, like the webhook's existing replies, and uses the typographic apostrophe `’` so strings stay in single quotes.
- Copy, verbatim:
  - Photo or file with no caption: `I can’t open photos or files here yet. Type what you need, or send the file in the Jentera app chat.`
  - Voice note: `I can’t listen to voice notes yet. Please type your message.` (The spec's single line also told voice to use the app; the app chat accepts no audio — `CHAT_FILE_ACCEPT`, `app/src/routes/views/AskJenteraView.tsx:51` — so voice points at the keyboard only.)
  - Everything else recognised: `I can only read text messages for now.`
- `cd worker && pnpm test` needs Docker running. `pnpm typecheck` runs twice (src, then src + test); both must be clean. If lease tests fail on timing, compare `docker run --rm alpine date` with `date` — the Docker VM clock drifts.
- Assert as `aisar_app`, arrange as owner (`worker/test/harness.ts`). The tests below already do.
- Stage **named paths**. Never `git add -A` or `git add .`.
- Commits: Conventional Commit subjects. End each message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but its piece 0 section does not spell out, most likely to bite first. Each has a test in the task named.

1. **A GIF.** Telegram sends it with both `animation` and `document`. It must read as a GIF ("only text" reply), not as a file inviting an app upload. Task 1.
2. **Service messages in the owner's private chat** (a pin, an auto-delete timer change). They carry no text and no media; they must stay silent, not draw "I can only read text". Task 1.
3. **A stranger sending the bot a photo.** They must get the existing "not authorised" notice, never the media reply and never a run. Task 3.
4. **A photo posted in a group the bot was added to.** Silence, as for group text today. Task 3.
5. **A caption of only spaces, or a caption on a voice note or video.** Treated as no caption: reply, no run. Task 1.

---

### Task 1: Read what arrives

**Files:**
- Modify: `worker/src/connectors/telegram.ts` (`IncomingMessage` and `parseUpdate`, near line 603 and 655)
- Test: `worker/test/webhook.test.ts` (describe `'reading an update'`, near line 159)

**Interfaces:**
- Produces, all exported from `worker/src/connectors/telegram.ts`:
  - `UNSEEN_KINDS: readonly ['photo', 'document', 'voice', 'audio', 'video', 'video_note', 'sticker', 'animation', 'location', 'contact']`
  - `type UnseenKind = typeof UNSEEN_KINDS[number]`
  - `IncomingMessage` gains `unseen?: UnseenKind`
  - `parseUpdate(body: unknown): IncomingMessage | null` — media with no readable caption returns `text: ''` and `unseen` set
  - `unreadableReply(kind: UnseenKind): string`
  - `withUnseenMediaNote(text: string, unseen?: UnseenKind): string`

- [ ] **Step 1: Create the worktree and record the baseline**

The Bash tool does not keep `cd` between calls, so print the path and use it absolutely from here on.

```bash
cd ~/ios/aisar-site && wt new telegram-stopgap && pwd
```

Then, in the printed worktree path (call it `$WT`):

```bash
cd $WT && git fetch -q origin && git reset --hard origin/main && git log --oneline -1
[ -L worker/node_modules ] && rm worker/node_modules   # removes a symlink only, never its target
cd $WT/worker && pnpm install --frozen-lockfile
cd $WT/worker && pnpm typecheck && pnpm test 2>&1 | tail -40
```

Write down every failing test name from the baseline run. Those are not yours; anything that fails later and is not on that list is.

- [ ] **Step 2: Write the failing tests**

In `worker/test/webhook.test.ts`, add `unreadableReply` and `withUnseenMediaNote` to the existing import from `'../src/connectors/telegram'`.

Replace the existing test `'does not mistake a caption or a sticker for text'` with:

```ts
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
```

After the `'reading an update'` describe block closes, add:

```ts
describe('answering what the agent cannot read', () => {
  it('points photos and files at the app, voice at the keyboard, and the rest at text', () => {
    expect(unreadableReply('photo')).toBe(
      'I can’t open photos or files here yet. Type what you need, or send the file in the Jentera app chat.',
    );
    expect(unreadableReply('document')).toBe(unreadableReply('photo'));
    expect(unreadableReply('voice')).toBe('I can’t listen to voice notes yet. Please type your message.');
    for (const kind of ['audio', 'video', 'video_note', 'sticker', 'animation', 'location', 'contact'] as const) {
      expect(unreadableReply(kind)).toBe('I can only read text messages for now.');
    }
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd $WT/worker && pnpm vitest run test/webhook.test.ts`
Expected: FAIL — `unreadableReply is not a function` / `withUnseenMediaNote is not a function`, and the media cases returning `null`.

- [ ] **Step 4: Implement**

In `worker/src/connectors/telegram.ts`, replace the `IncomingMessage` interface with:

```ts
/** Content a Telegram message can carry that the agent cannot read yet.
    Anything not listed — service messages, polls, edits — stays silent. */
export const UNSEEN_KINDS = [
  'photo',
  'document',
  'voice',
  'audio',
  'video',
  'video_note',
  'sticker',
  'animation',
  'location',
  'contact',
] as const;
export type UnseenKind = typeof UNSEEN_KINDS[number];

/** Only these have their caption read as the request; any other caption is
    about something the agent cannot see at all. */
const CAPTION_READ: ReadonlySet<UnseenKind> = new Set(['photo', 'document']);

export interface IncomingMessage {
  chatId: number;
  messageId: number;
  from: string;
  text: string;
  privateChat: boolean;
  /** Set when the message carried content the agent is not given. `text` is
      then the caption of a photo or file, or empty. */
  unseen?: UnseenKind;
}
```

Replace the doc comment and body of `parseUpdate` with:

```ts
/**
 * Pull the one update shape we handle out of a webhook body.
 *
 * A text message comes back as its text. A photo, file, voice note or other
 * content the agent cannot read yet comes back with `unseen` set, so the
 * webhook can say so instead of going silent — which made a working bot look
 * broken (24 September). Returns null for everything else: edits, joins,
 * channel posts, service messages. Silence is right for those: Telegram
 * retries on a non-2xx, so an error would have them redelivered forever.
 */
export function parseUpdate(body: unknown): IncomingMessage | null {
  if (typeof body !== 'object' || body === null) return null;
  const msg = (body as { message?: Record<string, unknown> }).message;
  if (!msg) return null;

  const chat = msg.chat as { id?: number; type?: string } | undefined;
  const from = msg.from as { first_name?: string; username?: string } | undefined;
  if (typeof chat?.id !== 'number' || typeof msg.message_id !== 'number') return null;

  const base = {
    chatId: chat.id,
    messageId: msg.message_id,
    from: from?.first_name ?? from?.username ?? 'Someone',
    privateChat: chat.type === 'private',
  };

  const text = msg.text;
  if (typeof text === 'string' && text.trim() !== '') {
    // Long enough for a real question, short enough not to be a payload.
    return { ...base, text: text.slice(0, 4000) };
  }

  const unseen = unseenKind(msg);
  if (!unseen) return null;
  const caption = CAPTION_READ.has(unseen) && typeof msg.caption === 'string' && msg.caption.trim() !== ''
    ? msg.caption.slice(0, 4000)
    : '';
  return { ...base, text: caption, unseen };
}

function unseenKind(msg: Record<string, unknown>): UnseenKind | null {
  // A GIF also carries `document`; it must not read as a file.
  if (msg.animation) return 'animation';
  // A venue carries `location` as well, and reads as one.
  return UNSEEN_KINDS.find((kind) => kind !== 'animation' && Boolean(msg[kind])) ?? null;
}

/** The owner's answer when a message held nothing the agent can read. */
export function unreadableReply(kind: UnseenKind): string {
  if (kind === 'photo' || kind === 'document') {
    return 'I can’t open photos or files here yet. Type what you need, or send the file in the Jentera app chat.';
  }
  if (kind === 'voice') return 'I can’t listen to voice notes yet. Please type your message.';
  return 'I can only read text messages for now.';
}

const UNSEEN_NOUN: Record<UnseenKind, string> = {
  photo: 'a photo',
  document: 'a file',
  voice: 'a voice note',
  audio: 'an audio file',
  video: 'a video',
  video_note: 'a video message',
  sticker: 'a sticker',
  animation: 'a GIF',
  location: 'a location',
  contact: 'a contact card',
};

/** The agent's input when the owner's message came with something it is not
    given. Without this it answers "record this receipt" as though it had read
    the receipt. The note is for the agent only; the run keeps the caption. */
export function withUnseenMediaNote(text: string, unseen?: UnseenKind): string {
  if (!unseen) return text;
  return `${text}\n\n` +
    `The owner sent this message with ${UNSEEN_NOUN[unseen]} attached. It was not delivered ` +
    'to you and is not on your filesystem, so do not search for it or guess what it shows. ' +
    'If the request depends on it, say you cannot see it yet and ask them to type the details ' +
    'or send the file in the Jentera app chat.';
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd $WT/worker && pnpm vitest run test/webhook.test.ts`
Expected: PASS, including the unchanged `'reads a plain message'` (its `toEqual` has no `unseen` key, and a text message gets none) and `'ignores everything it does not handle'`.

- [ ] **Step 6: Commit**

```bash
cd $WT && git add worker/src/connectors/telegram.ts worker/test/webhook.test.ts
git commit -m "$(cat <<'EOF'
feat(telegram): recognise photos, files and voice notes in updates

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Carry the note to the agent

**Files:**
- Modify: `worker/src/telegram-delivery.ts` (`TelegramIncoming`, near line 16)
- Modify: `worker/src/routes/connect.ts` (`handleIncoming`, near line 786, both paths)
- Modify: `worker/src/runtime/consumer.ts` (`TelegramIntakeQueueMessage` near line 225, the import block ending near line 97, `prepareHermesAgent(` call near line 706, `validTelegramIntake` near line 2834)
- Test: `worker/test/orchestration.test.ts` (describe `'durable Hermes Telegram replies'`, near line 257)

**Interfaces:**
- Consumes from Task 1: `UNSEEN_KINDS`, `type UnseenKind`, `withUnseenMediaNote(text, unseen?)`.
- Produces: `TelegramIncoming.unseen?: UnseenKind`; `TelegramIntakeQueueMessage['incoming'].unseen?: UnseenKind`. Task 3 relies on `handleIncoming` forwarding `unseen` into the queue message.

- [ ] **Step 1: Write the failing tests**

In `worker/test/orchestration.test.ts`, inside describe `'durable Hermes Telegram replies'`, after the test `'deduplicates Telegram retries before they can buy a second Hermes run'`, add:

```ts
  it('tells the agent about a photo it was not given, and keeps only the caption on the run', async () => {
    await setPolicy('automatic');
    const provider = new LocalRuntimeProvider();
    const queued: RuntimeQueueMessage[] = [];
    const durableEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-4',
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
      RUNTIME_QUEUE: {
        send: async (message: RuntimeQueueMessage) => {
          queued.push(message);
        },
      },
    });
    await ensureProviderRuntime(durableEnv, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.28-4', 'v1'));

    await handleIncoming(durableEnv, A, connId, {
      ...incoming,
      messageId: 777,
      text: 'Record this receipt',
      unseen: 'photo',
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      kind: 'telegram_intake',
      incoming: { text: 'Record this receipt', unseen: 'photo' },
    });

    const starts: { input?: string }[] = [];
    const runner = successfulRunner('I can’t see the photo yet.');
    await expect(handleRuntimeQueueMessage(durableEnv, queued[0], {
      provider,
      fetch: async (input, init) => {
        if (String(input).endsWith('/v1/tasks') && init?.method === 'POST') {
          starts.push(JSON.parse(String(init.body)) as { input?: string });
        }
        return runner(input, init);
      },
    })).resolves.toEqual({ action: 'ack', reason: 'completed' });

    expect(starts).toHaveLength(1);
    expect(starts[0].input).toContain('Record this receipt');
    expect(starts[0].input).toMatch(/with a photo attached/);
    const [run] = await asTenant(A, (tx) => tx<{ question: string }[]>`
      select trigger_ref->>'question' as question from run
       order by created_at desc limit 1`);
    expect(run.question).toBe('Record this receipt');
  });

  it('refuses an intake naming an attachment kind it does not know', async () => {
    const durableEnv = testEnv({
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    await expect(handleRuntimeQueueMessage(durableEnv, {
      version: 2,
      kind: 'telegram_intake',
      businessId: A,
      connectionId: connId,
      requestedAtMs: Date.now(),
      incoming: {
        chatId: 42,
        messageId: 778,
        from: 'Aminah',
        text: 'hello',
        privateChat: true,
        unseen: 'hologram',
      },
    } as unknown as RuntimeQueueMessage)).resolves.toEqual({ action: 'ack', reason: 'missing' });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd $WT/worker && pnpm vitest run test/orchestration.test.ts -t "attachment kind|photo it was not given"`
Expected: FAIL — the queued message has no `unseen`, the runner input has no note, and the unknown kind is admitted instead of acked `missing`. (`pnpm typecheck` also fails on `unseen` in `TelegramIncoming` until Step 3.)

- [ ] **Step 3: Implement**

`worker/src/telegram-delivery.ts` — add `type UnseenKind,` to the existing import from `'./connectors/telegram'`, and add a field to `TelegramIncoming`:

```ts
export interface TelegramIncoming {
  chatId: number;
  messageId?: number;
  from: string;
  text: string;
  privateChat?: boolean;
  /** Content the agent was not given (connectors/telegram.ts). */
  unseen?: UnseenKind;
}
```

`worker/src/runtime/consumer.ts`:

1. Add `UNSEEN_KINDS,`, `withUnseenMediaNote,` and `type UnseenKind,` to the import block that ends `} from '../connectors/telegram';`.
2. In `TelegramIntakeQueueMessage`, add to `incoming`:

```ts
    privateChat: true;
    /** A photo or file came with the caption in `text` and was not delivered. */
    unseen?: UnseenKind;
```

3. Replace the first argument of the Telegram admission's `prepareHermesAgent(` call — the lines

```ts
      const prepared = prepareHermesAgent(
        message.incoming.text,
        facts,
```

with

```ts
      const prepared = prepareHermesAgent(
        /* The note goes to the agent only. The run, the task's `telegram`
           block, retrieval and specialist routing all keep the caption. */
        withUnseenMediaNote(message.incoming.text, message.incoming.unseen),
        facts,
```

4. In `validTelegramIntake`, extend the final line of the return expression:

```ts
    incoming.text.length <= 4_000 && incoming.privateChat === true &&
    (incoming.unseen === undefined ||
      (UNSEEN_KINDS as readonly string[]).includes(incoming.unseen));
```

`worker/src/routes/connect.ts`:

1. Add `withUnseenMediaNote,` to the import block that ends `} from '../connectors/telegram';` (near line 48).
2. In `handleIncoming`, forward the field in the durable path:

```ts
    const message = {
      chatId: incoming.chatId,
      messageId: incoming.messageId as number,
      from: incoming.from,
      text: incoming.text,
      privateChat: true as const,
      ...(incoming.unseen ? { unseen: incoming.unseen } : {}),
    };
```

3. In the legacy path of the same function, replace

```ts
      () => runtime.answerQuestion(incoming.text, facts, []),
```

with

```ts
      () => runtime.answerQuestion(withUnseenMediaNote(incoming.text, incoming.unseen), facts, []),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd $WT/worker && pnpm typecheck && pnpm vitest run test/orchestration.test.ts`
Expected: typecheck clean; the orchestration file passes apart from baseline failures recorded in Task 1.

- [ ] **Step 5: Commit**

```bash
cd $WT && git add worker/src/telegram-delivery.ts worker/src/routes/connect.ts worker/src/runtime/consumer.ts worker/test/orchestration.test.ts
git commit -m "$(cat <<'EOF'
feat(telegram): tell the agent when a caption came without its photo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Answer instead of staying silent

**Files:**
- Modify: `worker/src/routes/connect.ts` (`telegramWebhook`, the owner branch before the `/stop` check near line 648)
- Test: `worker/test/routes.test.ts` (a helper beside `telegramHook` near line 89; tests in describe `'connections'`)

**Interfaces:**
- Consumes from Task 1: `unreadableReply(kind)`; `parseUpdate` returning `text: ''` with `unseen`.
- Consumes from Task 2: `handleIncoming` forwarding `unseen` to the queue.

- [ ] **Step 1: Write the failing tests**

In `worker/test/routes.test.ts`, after the `telegramHook` function, add:

```ts
async function telegramUpdate(
  connectionId: string,
  secret: string,
  message: Record<string, unknown>,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
) {
  const url = new URL(`https://api.test/api/webhooks/telegram/${A}/${connectionId}`);
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify({ update_id: Number(message.message_id), message: { date: 1, ...message } }),
  });
  const response = await handleConnect(request, env, url, cors, ctx);
  if (!response) throw new Error('Telegram webhook did not match');
  return response;
}
```

In describe `'connections'`, after the test `'returns 503 when Queue is unavailable so Telegram redelivers the message'`, add:

```ts
  it('answers a photo, voice note or sticker it cannot read, and starts no run', async () => {
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    const queued: unknown[] = [];
    env = automaticRuntimeEnv(async (message) => { queued.push(message); });

    const owner = { chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Owner' } };
    const cases: [Record<string, unknown>, string][] = [
      [{ message_id: 40, photo: [{ file_id: 'p' }] },
        'I can’t open photos or files here yet. Type what you need, or send the file in the Jentera app chat.'],
      [{ message_id: 41, voice: { file_id: 'v', duration: 3 } },
        'I can’t listen to voice notes yet. Please type your message.'],
      [{ message_id: 42, sticker: { emoji: '👍' } }, 'I can only read text messages for now.'],
    ];
    for (const [message, reply] of cases) {
      fetch.mockClear();
      const response = await telegramUpdate(paired.connectionId, paired.secret, { ...owner, ...message });
      expect(response.status).toBe(200);
      const sends = fetch.mock.calls.filter(([input]) => String(input).includes('/sendMessage'));
      expect(sends).toHaveLength(1);
      expect(JSON.parse(String(sends[0][1]?.body))).toMatchObject({ chat_id: 42, text: reply });
    }
    expect(queued).toHaveLength(0);
    expect(await asTenant(A, (tx) => tx`select id from run`)).toHaveLength(0);
  });

  it('runs a captioned photo as its caption, flagged as unseen', async () => {
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    const queued: unknown[] = [];
    env = automaticRuntimeEnv(async (message) => { queued.push(message); });
    fetch.mockClear();

    const response = await telegramUpdate(paired.connectionId, paired.secret, {
      message_id: 43,
      chat: { id: 42, type: 'private' },
      from: { id: 42, first_name: 'Owner' },
      photo: [{ file_id: 'p' }],
      caption: 'Record this receipt',
    });
    expect(response.status).toBe(200);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      kind: 'telegram_intake',
      incoming: { chatId: 42, text: 'Record this receipt', unseen: 'photo' },
    });
    expect(fetch.mock.calls.filter(([input]) => String(input).includes('/sendMessage')))
      .toHaveLength(0);
  });

  it('gives a stranger’s photo the pairing refusal, and a group’s photo nothing', async () => {
    const fetch = fetchFake(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    vi.stubGlobal('fetch', fetch);
    const paired = await pairTelegramChat(42);
    fetch.mockClear();

    await telegramUpdate(paired.connectionId, paired.secret, {
      message_id: 50,
      chat: { id: 999, type: 'private' },
      from: { id: 999, first_name: 'Stranger' },
      photo: [{ file_id: 'p' }],
    });
    const toStranger = fetch.mock.calls.filter(([input]) => String(input).includes('/sendMessage'));
    expect(toStranger).toHaveLength(1);
    expect(JSON.parse(String(toStranger[0][1]?.body))).toMatchObject({
      chat_id: 999,
      text: expect.stringMatching(/not authorised/i),
    });
    fetch.mockClear();

    await telegramUpdate(paired.connectionId, paired.secret, {
      message_id: 51,
      chat: { id: -100123, type: 'group' },
      from: { id: 42, first_name: 'Owner' },
      photo: [{ file_id: 'p' }],
    });
    expect(fetch.mock.calls.filter(([input]) => String(input).includes('/sendMessage')))
      .toHaveLength(0);
    expect(await asTenant(A, (tx) => tx`select id from run`)).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd $WT/worker && pnpm vitest run test/routes.test.ts -t "cannot read|captioned photo|stranger’s photo"`
Expected: the first test FAILS — no `sendMessage` is made for an uncaptioned photo; instead it is admitted and queued as an empty message (which the consumer would later ack as `missing`), so `queued` has entries. The captioned-photo and stranger tests may already pass after Tasks 1–2; that is expected, since they pin behaviour the next step must not break.

- [ ] **Step 3: Implement**

In `worker/src/routes/connect.ts`, add `unreadableReply,` to the import block that ends `} from '../connectors/telegram';`.

In `telegramWebhook`, immediately above the line

```ts
  if (/^\/(stop|cancel)(?:@[A-Za-z0-9_]+)?$/.test(incoming.text.trim())) {
```

insert:

```ts
  /* Nothing here the agent can read: a photo or file with no caption, a voice
     note, a sticker. Say so. Silence made a working bot look broken on
     24 September. This is after the pairing check, so only the owner is
     answered, and before admission, so it never costs a paid run. */
  if (incoming.unseen && incoming.text.trim() === '') {
    await sendMessage(token, incoming.chatId, unreadableReply(incoming.unseen)).catch(() => {});
    return ok;
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd $WT/worker && pnpm vitest run test/routes.test.ts test/webhook.test.ts`
Expected: PASS apart from baseline failures.

- [ ] **Step 5: Commit**

```bash
cd $WT && git add worker/src/routes/connect.ts worker/test/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(telegram): reply to photos and voice notes instead of ignoring them

A photo, file, voice note or sticker sent to the bot was dropped with a
200 and no reply, so a working bot looked dead. The paired owner now
gets one line saying what the bot cannot read yet; no run is started.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Record it, verify it, ship it

**Files:**
- Modify: `docs/todo.md` (the row titled `**Telegram voice notes vanish**`, near line 80)

The last three steps are outward-facing. **Stop and ask the owner before each of Steps 4, 5 and 6.**

- [ ] **Step 1: Update the todo row**

In `docs/todo.md`, in the row that begins `| **Telegram voice notes vanish** |`, make two replacements.

Replace:

```
| **Telegram voice notes vanish** |
```

with:

```
| **Telegram voice notes are not understood** |
```

Replace:

```
gets no reply and no trace.
```

with:

```
has had a one-line "can’t listen yet" reply since the 24 September stopgap, but is still not understood and leaves no trace. Designed as piece 3 of `docs/superpowers/specs/2026-09-24-telegram-media-design.md`.
```

Both strings exist once on `origin/main` as of 24 September. If either is not found exactly (the file moves under other sessions), make the equivalent edit by hand and keep the rest of the row unchanged.

- [ ] **Step 2: Verify the whole worker**

```bash
cd $WT/worker && pnpm typecheck && pnpm test 2>&1 | tail -40
```

Expected: typecheck clean in both passes. The only failing tests are the ones in the Task 1 baseline list. Any other failure is yours: fix it before going on.

- [ ] **Step 3: Commit**

```bash
cd $WT && git add docs/todo.md
git commit -m "$(cat <<'EOF'
docs(todo): voice notes now get a reply, not yet understood

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Integrate into main (ask the owner first)**

`wt merge` squash-merges into `main` in the shared checkout, and git refuses when a file it must write has uncommitted edits there. Check first:

```bash
cd ~/ios/aisar-site && git status --short -- worker/src/connectors/telegram.ts worker/src/routes/connect.ts worker/src/runtime/consumer.ts worker/src/telegram-delivery.ts worker/test/webhook.test.ts worker/test/orchestration.test.ts worker/test/routes.test.ts docs/todo.md
```

- **Nothing listed:** from `$WT`, run `wt merge`, then `git -C ~/ios/aisar-site log --oneline -3` and read `origin/main..main` before pushing. Push only with the owner's go-ahead, and only if every commit in that range is one the owner expects to publish.
- **Anything listed** (on 24 September, `consumer.ts` and `docs/todo.md` were): do not merge. Report the files to the owner and let them choose between waiting for the other session to commit, and publishing the branch another way.

- [ ] **Step 5: Deploy the worker (ask the owner first)**

Deploy from `$WT`, never from the shared checkout: `wrangler deploy` publishes the working tree, and the shared one holds other sessions' unfinished worker changes, including a notification kind that must not ship before the app.

```bash
cd $WT && git fetch -q origin && git status --short && git diff --stat origin/main -- worker/
```

Expected: no local changes, and no diff against `origin/main` under `worker/` (the change is on main and nothing newer is missing). If `origin/main` has moved, rebase `$WT` onto it and re-run Step 2 first. Then:

```bash
cd $WT/worker && pnpm run deploy
```

`predeploy` runs the bundle and transfer-field guards; both must pass. Nothing here changes the runtime bundle or a transfer field.

- [ ] **Step 6: Check it live, then clean up**

Ask the owner to send `@jentera_bot`, from their paired chat:

1. a photo with no caption → expect the photos-and-files line,
2. a voice note → expect the voice line,
3. a sticker → expect the text-only line,
4. a photo captioned `What is this?` → expect an answer that says it cannot see the photo.

Confirm case 4 in production. The newest Telegram run's question must be the caption alone:

```bash
cd ~/ios/aisar-site && ./worker/scripts/stats.sh sql "select created_at, status, trigger_ref->>'question' as question from run where trigger_shape = 'owner.message.telegram' order by created_at desc limit 3"
```

Expected: the newest row reads `What is this?`, with no note text. Cases 1–3 add no rows. Then remove the worktree with `wt rm` from `$WT`.
