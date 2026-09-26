/* ============================================================
   Telegram, via a bot token the business owner supplies.

   Each business connects its own bot. That is not incidental: a shared
   bot would put every owner's private business conversation through one
   identity. The owner's bot is their private agent and their token to
   revoke. Customer-facing use is a separate, explicit mode.

   The token never leaves the vault except to be used. It is not
   logged, not returned by any endpoint, and not shown back to the
   owner after it is saved.
   ============================================================ */

import { sanitizePublicRuntimeText } from '../runtime/public-output';
import {
  callVaultTelegram,
  isVaultTelegramCredential,
  type TelegramCredential,
} from '../vault/telegram';

const API = 'https://api.telegram.org';

async function telegramFetch(
  credential: TelegramCredential,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (isVaultTelegramCredential(credential)) {
    let payload: Record<string, unknown> | undefined;
    if (typeof init.body === 'string') {
      const parsed = JSON.parse(init.body) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid Telegram request payload');
      }
      payload = parsed as Record<string, unknown>;
    }
    return callVaultTelegram(
      credential,
      (init.method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
      path,
      payload,
    );
  }
  return fetch(`${API}/bot${credential}${path}`, init);
}

/** Minimum gap between live-bubble edits. Distinct status updates outside the
    window publish at once — live steps must surface — while bursts inside the
    window coalesce to the newest status, so churn cannot hammer Telegram. */
const STATUS_COOLDOWN_MS = 500;

export interface BotIdentity {
  id: number;
  username: string;
  name: string;
}

/** The update types we register for. Telegram records this set at
    registration time, so a webhook registered before callback_query
    shipped keeps receiving messages but never approval taps until it
    is re-registered. Stored on the connection (`webhook_updates`) so
    the receive path can spot and heal exactly that once. */
export const WEBHOOK_ALLOWED_UPDATES = ['message', 'callback_query'] as const;

/** A token is only real if Telegram says so. */
export async function verifyToken(token: string): Promise<BotIdentity> {
  const res = await fetch(`${API}/bot${token}/getMe`, {
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: { id?: number; username?: string; first_name?: string };
    description?: string;
  } | null;

  if (!body?.ok || !body.result?.id || !body.result.username) {
    /* Telegram's own words where it has any — "Unauthorized" tells the
       owner they pasted the wrong thing far better than a generic
       failure would. */
    throw new Error(body?.description ?? 'Telegram did not recognise that token');
  }
  return {
    id: body.result.id,
    username: body.result.username,
    name: body.result.first_name ?? body.result.username,
  };
}

/**
 * Point the bot at us.
 *
 * `secret_token` is the whole verification story for the webhook:
 * Telegram sends it back in a header on every update, so an endpoint
 * that checks it cannot be fed forged updates by anyone who merely
 * guesses the URL. Without it the webhook path is a public write
 * endpoint into a business's conversation history.
 */
export async function setWebhook(
  token: TelegramCredential,
  url: string,
  secret: string,
): Promise<void> {
  const res = await telegramFetch(token, '/setWebhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      // Only what we act on. Fewer update types is less to validate and
      // less that arrives unhandled.
      allowed_updates: [...WEBHOOK_ALLOWED_UPDATES],
      // A connection being re-made should not replay a backlog the
      // owner never saw.
      drop_pending_updates: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!body?.ok) throw new Error(body?.description ?? 'Telegram refused the webhook');
}

/** Stop receiving. Called when a connection is removed. */
export async function clearWebhook(token: TelegramCredential): Promise<void> {
  await telegramFetch(token, '/deleteWebhook', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    /* The connection is going away regardless. A bot we cannot reach
       is not a reason to leave a row behind claiming it is connected. */
  });
}

export async function sendMessage(
  token: TelegramCredential,
  chatId: number | string,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<{ messageId: number }> {
  const visibleText = sanitizePublicRuntimeText(text);
  const res = await telegramFetch(token, '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: visibleText,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  } | null;
  if (!body?.ok || !body.result?.message_id) {
    throw new Error(body?.description ?? 'Telegram would not deliver that message');
  }
  return { messageId: body.result.message_id };
}

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

/** Persist the final answer as an ordinary Telegram message. Telegram's newer
    rich-message lane is useful for ephemeral streaming drafts, but some clients
    do not expose their normal copy controls. The durable answer must remain
    selectable and copyable, so it deliberately uses sendMessage. */
export async function sendHermesMessage(
  token: TelegramCredential,
  chatId: number | string,
  text: string,
): Promise<{ messageId: number }> {
  return sendMessage(token, chatId, text);
}

/** Tell Telegram that the bot is composing a reply. This is deliberately a
    separate best-effort signal: failure must never suppress the real answer. */
export async function sendTyping(token: TelegramCredential, chatId: number | string): Promise<void> {
  const res = await telegramFetch(token, '/sendChatAction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    signal: AbortSignal.timeout(3_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!body?.ok) throw new Error('Telegram refused the typing indicator');
}

/** Replace the text of a bot-owned message. Used to stream the live working
    bubble without ever touching the user's composer — unlike Telegram's
    input-field draft preview, a normal message leaves the user free to type.

    Telegram rejects an edit whose text is byte-identical to the current
    message ("message is not modified"). That is NOT a failure: the bubble
    already shows exactly the text we wanted (e.g. the consumer reattaches to
    the webhook's "⏳ Thinking…" bubble and the first status is
    the same string). Throwing on it would kill the whole live lane, so it is
    treated as a successful no-op instead. */
export async function editMessageText(
  token: TelegramCredential,
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  const visibleText = sanitizePublicRuntimeText(text);
  const res = await telegramFetch(token, '/editMessageText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: visibleText,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;
  if (!body?.ok) {
    if (body?.description?.toLowerCase().includes('message is not modified')) return;
    throw new Error(body?.description ?? 'Telegram refused that edit');
  }
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/** Remove or replace controls without mutating the live bubble's text. */
export async function editMessageReplyMarkup(
  token: TelegramCredential,
  chatId: number | string,
  messageId: number,
  replyMarkup: TelegramInlineKeyboardMarkup = { inline_keyboard: [] },
): Promise<void> {
  const res = await telegramFetch(token, '/editMessageReplyMarkup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;
  if (!body?.ok && !body?.description?.toLowerCase().includes('message is not modified')) {
    throw new Error(body?.description ?? 'Telegram refused that keyboard edit');
  }
}

/** Stop Telegram's button spinner. Text is deliberately generic: detailed
    authorization failures stay in logs, not in an attacker-controlled chat. */
export async function answerCallbackQuery(
  token: TelegramCredential,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(callbackQueryId)) return;
  const res = await telegramFetch(token, '/answerCallbackQuery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      ...(text ? { text: text.slice(0, 200) } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!body?.ok) throw new Error('Telegram refused the callback acknowledgement');
}

/** Remove a bot-owned message. Used to tidy the live working bubble once the
    durable answer lands (or a run dies), mirroring the old draft expiry. */
export async function deleteMessage(
  token: TelegramCredential,
  chatId: number | string,
  messageId: number,
): Promise<void> {
  const res = await telegramFetch(token, '/deleteMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!body?.ok) throw new Error('Telegram refused the deletion');
}

export interface TelegramLiveStreamOptions {
  /** Reattach to a live bubble created earlier (e.g. by the webhook's
      admission path or a previous queue slice). Without it the stream
      creates its own bubble on first publish. */
  messageId?: number;
  /** Called once when the stream creates the bubble, so the caller can
      persist the message id for later slices to reattach to. */
  onMessageId?: (messageId: number) => Promise<void>;
  /** Called after Telegram accepts the first answer-text send/edit. This is
      deliberately distinct from receiving a model delta: it measures what
      the customer can actually see. */
  onFirstTextPublished?: () => void;
}

/** Coalesce model tokens into a single bot-owned live message. The bubble is
    a normal message that sendMessage creates and editMessageText replaces —
    deliberately NOT Telegram's input-field draft: drafts render inside the
    user's composer and lock typing until the run finishes. A normal message
    leaves the user free to type and queue the next request. It stores text
    only in this Worker invocation and never emits more than about one update
    per second — status churn is additionally coalesced to a bounded rate —
    inside Telegram's documented per-peer limits. */
export class TelegramLiveStream {
  private text = '';
  private status = '';
  private sent = '';
  private lastSentAt = 0;
  private lastTypingAt = 0;
  private available = true;
  private typingAvailable = true;
  private messageId: number | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingStatus: string | undefined;
  private firstTextPublished = false;
  private lastProgress = '';
  private progressCount = 0;

  constructor(
    private readonly token: TelegramCredential,
    private readonly chatId: number | string,
    options: TelegramLiveStreamOptions = {},
  ) {
    this.messageId = options.messageId || undefined;
    this.onMessageId = options.onMessageId;
    this.onFirstTextPublished = options.onFirstTextPublished;
  }

  private readonly onMessageId: ((messageId: number) => Promise<void>) | undefined;
  private readonly onFirstTextPublished: (() => void) | undefined;

  /** The live bubble's Telegram message id once it exists. */
  get id(): number | undefined {
    return this.messageId;
  }

  async push(delta: string): Promise<void> {
    if (!this.available || !delta) return;
    if (!this.text.trim() && delta.trim()) {
      // Answer lane begins: drop the status and restart coalescing so the
      // first answer delta publishes immediately instead of being measured
      // against the status text that replaced the placeholder. Any held
      // status belongs to the phase the answer is replacing.
      this.status = '';
      this.sent = '';
      this.lastSentAt = 0;
      if (this.statusTimer) clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
      this.pendingStatus = undefined;
    }
    this.text = `${this.text}${delta}`.slice(0, 4_000);
    if (this.text === this.sent) return;
    const elapsed = Date.now() - this.lastSentAt;
    const buffered = this.text.length - this.sent.length;
    if (this.lastSentAt !== 0 && elapsed < 800 && buffered < 24) return;
    await this.publish();
  }

  /** Replace the working bubble text while the model has produced no answer
      text yet. Distinct updates publish at once — live steps must surface —
      but only after a short cooldown from the last published edit, and any
      burst inside the window coalesces onto the newest status, so churn
      cannot spam Telegram. Identical repeats are skipped. Ignored once text
      streams. */
  async setStatus(text: string): Promise<void> {
    if (!this.available || !text || this.text.trim()) return;
    const next = text.slice(0, 120);
    this.status = next;
    if (next === this.sent) return;
    const elapsed = Date.now() - this.lastSentAt;
    if (this.lastSentAt !== 0 && elapsed < STATUS_COOLDOWN_MS) {
      this.pendingStatus = next;
      this.scheduleStatusFlush();
      return;
    }
    await this.publish();
  }

  /** Schedule a single trailing edit for the newest status held during a
      churn burst. Latest-wins: every new held status overwrites the previous
      one and one timer fires at the cooldown boundary. */
  private scheduleStatusFlush(): void {
    if (this.statusTimer) return;
    const wait = Math.max(0, STATUS_COOLDOWN_MS - (Date.now() - this.lastSentAt));
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      if (!this.available || this.text.trim()) {
        this.pendingStatus = undefined;
        return;
      }
      const next = this.pendingStatus;
      this.pendingStatus = undefined;
      if (next && next !== this.sent) void this.publish();
    }, wait);
  }

  async flush(): Promise<void> {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
      this.pendingStatus = undefined;
    }
    if (!this.available || this.text === this.sent) return;
    await this.publish();
  }

  /** Telegram has conversational phase messages, not the web's tool trace.
      Never forward command arguments, private reasoning or claimed results. */
  async showTool(tool: string, preview?: string): Promise<void> {
    await this.showProgress(telegramToolProgress(tool));
  }

  async showProgress(text: string): Promise<void> {
    if (!this.available || !text || text === this.lastProgress || this.progressCount >= 12) return;
    this.lastProgress = text;
    this.progressCount += 1;
    try {
      await sendMessage(this.token, this.chatId, text);
      await this.pulseTyping(true);
    } catch {
      /* Progress chrome is cosmetic. The model run and final reply continue. */
    }
  }

  async heartbeat(): Promise<void> {
    await this.pulseTyping();
    if (!this.available || Date.now() - this.lastSentAt < 15_000) return;
    await this.publish();
  }

  /** Keep Telegram's separate chat-level typing affordance visible while the
      live bubble is active. Bubble edits and typing support fail independently
      so a cosmetic rejection cannot disable the other lane. */
  async pulseTyping(force = false): Promise<void> {
    if (!this.typingAvailable || (!force && Date.now() - this.lastTypingAt < 4_000)) return;
    this.lastTypingAt = Date.now();
    try {
      await sendTyping(this.token, this.chatId);
    } catch {
      this.typingAvailable = false;
    }
  }

  /** Stop every cosmetic update and transfer ownership of this ordinary
      Telegram message to the durable delivery path. Without this handoff, a
      coalesced status timer could fire after the final edit and overwrite the
      answer with stale progress text. */
  handoffMessageId(): number | undefined {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = undefined;
    this.pendingStatus = undefined;
    this.available = false;
    this.typingAvailable = false;
    return this.messageId;
  }

  /** Remove the live bubble once the durable answer has landed (or the run
      died), so no stale "⏳ Working…" message lingers in the chat. */
  async cleanup(): Promise<void> {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
      this.pendingStatus = undefined;
    }
    if (!this.messageId) return;
    try {
      await deleteMessage(this.token, this.chatId, this.messageId);
    } catch {
      /* Cosmetic. The durable answer is already in the chat. */
    }
  }

  private async publish(): Promise<void> {
    const visible = this.text.trim() ? this.text : (this.status || '⏳ Working…');
    try {
      if (!this.messageId) {
        const { messageId } = await sendMessage(this.token, this.chatId, visible);
        this.messageId = messageId;
        this.sent = visible;
        this.lastSentAt = Date.now();
        await this.onMessageId?.(messageId).catch(() => {});
      } else {
        await editMessageText(this.token, this.chatId, this.messageId, visible);
        this.sent = visible;
        this.lastSentAt = Date.now();
      }
      if (this.text.trim() && !this.firstTextPublished) {
        this.firstTextPublished = true;
        try {
          this.onFirstTextPublished?.();
        } catch {
          /* Telemetry is observational and must never disable delivery. */
        }
      }
      await this.pulseTyping();
    } catch (error) {
      /* The live lane is cosmetic and private-chat-only. A failure disables
         this stream but never suppresses the durable final reply. Log the
         cause so the first death is visible in wrangler tail (identical-text
         edits are already a no-op inside editMessageText, so reaching here
         means a REAL telegram error — chat gone, 429, message deleted,…). */
      console.warn('[telegram] live bubble lane died', {
        chatId: this.chatId,
        messageId: this.messageId,
        hadMessageId: Boolean(this.messageId),
        lastText: visible.slice(0, 120),
        error: error instanceof Error ? error.message : String(error),
      });
      this.available = false;
    }
  }
}

/** Event-grounded narration: describes an attempt, never unverified success. */
export function telegramToolProgress(tool: string): string {
  if (tool === 'web_search') return 'I’m searching for relevant information.';
  if (tool === 'web_extract' || tool.startsWith('browser_')) return 'I’m checking the page and reading the relevant details.';
  if (tool === 'terminal' || tool === 'execute_code') return 'I’m running the next check on the computer. I’ll let you know what I find.';
  if (tool === 'process') return 'I’m checking on the running process.';
  if (tool === 'read_file' || tool === 'search_files') return 'I’m checking the files for the information we need.';
  if (tool === 'write_file' || tool === 'patch') return 'I’m preparing the file changes.';
  if (tool === 'image_generate' || tool.startsWith('bfl_')) return 'I’m starting the image generation. This can take a little while.';
  if (tool === 'delegate_task') return 'I’m bringing in another specialist to help with this part.';
  if (tool === 'cronjob') return 'I’m working on the scheduled task and will check its status.';
  if (tool === 'memory') return 'I’m working with the saved context for this task.';
  return 'I’m working on the next part of your request.';
}

export function hermesToolLine(tool: string, preview?: string): string {
  const emoji = tool === 'execute_code' ? '🐍'
    : tool === 'terminal' || tool === 'process' ? '💻'
      : tool === 'web_search' ? '🔍'
        : tool === 'web_extract' || tool.startsWith('browser_') ? '🌐'
          : tool === 'image_generate' || tool.startsWith('bfl_') ? '🎨'
            : tool === 'delegate_task' ? '👥'
              : tool === 'cronjob' ? '⏰'
                : tool === 'memory' ? '🧠'
                  : /^(?:read_file|write_file|patch|search_files)$/.test(tool) ? '📁'
                    : '⚙️';
  const bounded = preview?.trim().slice(0, 1_000);
  return bounded ? `${emoji} ${tool}: "${bounded}"` : `${emoji} ${tool}...`;
}

/**
 * Keep Telegram's five-second typing status alive only while one automatic
 * response is being generated. Pulses never overlap, stop on the first
 * connector failure, and have a hard lifetime even if model work stalls.
 */
export async function withTypingIndicator<T>(
  token: TelegramCredential,
  chatId: number | string,
  work: () => Promise<T>,
  timing: { refreshMs?: number; maxMs?: number } = {},
): Promise<T> {
  const refreshMs = timing.refreshMs ?? 4_000;
  const maxMs = timing.maxMs ?? 30_000;
  const startedAt = Date.now();
  let active = true;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const pulse = async () => {
    if (!active || inFlight || Date.now() - startedAt >= maxMs) {
      if (Date.now() - startedAt >= maxMs && timer) clearInterval(timer);
      return;
    }
    inFlight = true;
    try {
      await sendTyping(token, chatId);
    } catch {
      /* A typing indicator is cosmetic. Stop retrying a broken chat action,
         but let generation and the real send continue normally. */
      active = false;
      if (timer) clearInterval(timer);
    } finally {
      inFlight = false;
    }
  };

  void pulse();
  timer = setInterval(() => void pulse(), refreshMs);
  try {
    return await work();
  } finally {
    active = false;
    clearInterval(timer);
  }
}

/** Content a Telegram message can carry that the agent cannot read yet.
    Anything not listed — service messages, edits — stays silent. */
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
  'poll',
  'dice',
  'story',
  'game',
  'paid_media',
] as const;
export type UnseenKind = typeof UNSEEN_KINDS[number];

/** Only these have their caption read as the request; any other caption is
    about something the agent cannot see at all. */
const CAPTION_READ: ReadonlySet<UnseenKind> = new Set(['photo', 'document']);

export interface TelegramVoice {
  fileId: string;
  fileUniqueId: string;
  durationS: number;
  size?: number;
}

/** Longer than this is refused at the webhook. Measured 26 Sep: a 9.5-minute
    note transcribes in one Whisper request in about 80 s. */
export const VOICE_MAX_SECONDS = 600;

/** Hearing a note holds its bytes, a binary string and their base64 at once,
    so Telegram's 20 MB file limit came near the isolate's 128 MB (review,
    26 Sep). A real ten-minute Opus note is about 2.5 MB. */
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;

export const VOICE_REPLIES = {
  tooLong: 'That voice note is longer than 10 minutes. Send a shorter one, or type your message.',
  unintelligible: 'I couldn’t make out that voice note. Please type your message.',
} as const;

export interface IncomingMessage {
  chatId: number;
  messageId: number;
  from: string;
  text: string;
  privateChat: boolean;
  /** Set when the message carried content the agent is not given. `text` is
      then the caption of a photo or file, or empty. */
  unseen?: UnseenKind;
  /** Telegram sends an album as one update per item, all sharing this id. */
  mediaGroupId?: string;
  /** The owner typed a caption on content whose caption is not read (a voice
      note, a video), so the reply asks for those words on their own. */
  captionIgnored?: true;
  /** A voice note to transcribe; `text` is then its caption, or empty. */
  voice?: TelegramVoice;
}

export interface IncomingCallbackQuery {
  id: string;
  approvalId: string;
  decision: 'approve' | 'deny';
  chatId: number;
  messageId: number;
  privateChat: boolean;
  senderId: number;
}

export function parseCallbackQuery(body: unknown): IncomingCallbackQuery | null {
  if (!body || typeof body !== 'object') return null;
  const query = (body as { callback_query?: Record<string, unknown> }).callback_query;
  if (!query || typeof query.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(query.id)) return null;
  const data = typeof query.data === 'string'
    ? /^har:(a|d):([0-9a-f-]{36})$/i.exec(query.data)
    : null;
  const message = query.message as Record<string, unknown> | undefined;
  const chat = message?.chat as { id?: unknown; type?: unknown } | undefined;
  const from = query.from as { id?: unknown } | undefined;
  if (!data || typeof message?.message_id !== 'number' ||
      !Number.isSafeInteger(message.message_id) || typeof chat?.id !== 'number' ||
      !Number.isSafeInteger(chat.id) || typeof from?.id !== 'number' ||
      !Number.isSafeInteger(from.id)) return null;
  return {
    id: query.id,
    approvalId: data[2],
    decision: data[1].toLowerCase() === 'a' ? 'approve' : 'deny',
    chatId: chat.id,
    messageId: message.message_id,
    privateChat: chat.type === 'private',
    senderId: from.id,
  };
}

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

  const voice = msg.voice as {
    file_id?: unknown; file_unique_id?: unknown; duration?: unknown; file_size?: unknown;
  } | undefined;
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

  const unseen = unseenKind(msg);
  if (!unseen) return null;
  const captioned = typeof msg.caption === 'string' && msg.caption.trim() !== '';
  const read = captioned && CAPTION_READ.has(unseen);
  return {
    ...base,
    text: read ? (msg.caption as string).slice(0, 4000) : '',
    unseen,
    ...(typeof msg.media_group_id === 'string' ? { mediaGroupId: msg.media_group_id } : {}),
    ...(captioned && !read ? { captionIgnored: true as const } : {}),
  };
}

function unseenKind(msg: Record<string, unknown>): UnseenKind | null {
  // A GIF also carries `document`; it must not read as a file.
  if (msg.animation) return 'animation';
  // A venue carries `location` as well, and reads as one.
  return UNSEEN_KINDS.find((kind) => kind !== 'animation' && Boolean(msg[kind])) ?? null;
}

const RESEND_CAPTION = 'Send the words you typed as their own message and I’ll answer them.';

/** The owner's answer when a message held nothing the agent can read. A
    caption the agent was not given is acknowledged, so the owner does not
    read the reply as their words being ignored. */
export function unreadableReply(kind: UnseenKind, captionIgnored = false): string {
  if (kind === 'photo' || kind === 'document') {
    return 'I can’t open photos or files here yet. Type what you need, or send the file in the Jentera app chat.';
  }
  if (kind === 'voice') {
    return captionIgnored
      ? `I can’t listen to voice notes yet. ${RESEND_CAPTION}`
      : 'I can’t listen to voice notes yet. Please type your message.';
  }
  return captionIgnored
    ? `I can only read text messages for now. ${RESEND_CAPTION}`
    : 'I can only read text messages for now.';
}

/** Why a voice note will not be heard, or null when it will. A vault-held
    bot cannot download yet (the vault has no file route), so it keeps the
    stopgap answer rather than failing later in admission. */
export function voiceRefusal(voice: TelegramVoice, credential: TelegramCredential): string | null {
  if (isVaultTelegramCredential(credential)) return unreadableReply('voice');
  if (voice.durationS > VOICE_MAX_SECONDS || (voice.size ?? 0) > VOICE_MAX_BYTES) {
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
  poll: 'a poll',
  dice: 'a dice roll',
  story: 'a story',
  game: 'a game',
  paid_media: 'paid media',
};

/** The agent's input when the owner's message came with something it is not
    given. Without this it answers "record this receipt" as though it had read
    the receipt. The note is for the agent only; the run keeps the caption. */
export function withUnseenMediaNote(text: string, unseen?: string): string {
  if (!unseen) return text;
  /* A kind a newer worker queued before a rollback is "something"; its name
     comes from the queue, never from this list, so it never reaches the prompt. */
  const noun = Object.hasOwn(UNSEEN_NOUN, unseen) ? UNSEEN_NOUN[unseen as UnseenKind] : 'something';
  return `${text}\n\n` +
    `The owner sent this message with ${noun} attached. It was not delivered ` +
    'to you and is not on your filesystem, so do not search for it or guess what it shows. ' +
    'If the request depends on it, say you cannot see it yet and ask them to type the details ' +
    'or send the file in the Jentera app chat.';
}

export interface WebhookHealth {
  url: string;
  pending: number;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Telegram will not deliver until this is cleared. */
  ip: string | null;
  /** Update types Telegram is set to deliver (['message','callback_query'] expected). */
  allowedUpdates: string[] | null;
}

/**
 * What Telegram thinks it is doing with this bot.
 *
 * The one authoritative answer to "why did nothing arrive". Telegram
 * keeps the last delivery error for a while, so a webhook pointing at
 * the wrong host, or one whose certificate it dislikes, says so here
 * rather than being invisible on our side — where the symptom is
 * simply an absence.
 */
export async function webhookHealth(token: TelegramCredential): Promise<WebhookHealth> {
  const res = await telegramFetch(token, '/getWebhookInfo', {
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: {
      url?: string;
      pending_update_count?: number;
      last_error_message?: string;
      last_error_date?: number;
      ip_address?: string;
      allowed_updates?: string[];
    };
    description?: string;
  } | null;
  if (!body?.ok || !body.result) {
    throw new Error(body?.description ?? 'Telegram would not answer');
  }
  const r = body.result;
  return {
    url: r.url ?? '',
    pending: r.pending_update_count ?? 0,
    lastError: r.last_error_message ?? null,
    lastErrorAt: r.last_error_date ? new Date(r.last_error_date * 1000).toISOString() : null,
    ip: r.ip_address ?? null,
    allowedUpdates: r.allowed_updates ?? null,
  };
}
