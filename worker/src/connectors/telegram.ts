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

const API = 'https://api.telegram.org';

/** Minimum gap between live-bubble edits. Distinct status updates outside the
    window publish at once — live steps must surface — while bursts inside the
    window coalesce to the newest status, so churn cannot hammer Telegram. */
const STATUS_COOLDOWN_MS = 500;

export interface BotIdentity {
  id: number;
  username: string;
  name: string;
}

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
  token: string,
  url: string,
  secret: string,
): Promise<void> {
  const res = await fetch(`${API}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      // Only what we act on. Fewer update types is less to validate and
      // less that arrives unhandled.
      allowed_updates: ['message', 'callback_query'],
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
export async function clearWebhook(token: string): Promise<void> {
  await fetch(`${API}/bot${token}/deleteWebhook`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    /* The connection is going away regardless. A bot we cannot reach
       is not a reason to leave a row behind claiming it is connected. */
  });
}

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<{ messageId: number }> {
  const visibleText = sanitizePublicRuntimeText(text);
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
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

/** Persist the final answer as an ordinary Telegram message. Telegram's newer
    rich-message lane is useful for ephemeral streaming drafts, but some clients
    do not expose their normal copy controls. The durable answer must remain
    selectable and copyable, so it deliberately uses sendMessage. */
export async function sendHermesMessage(
  token: string,
  chatId: number | string,
  text: string,
): Promise<{ messageId: number }> {
  return sendMessage(token, chatId, text);
}

/** Tell Telegram that the bot is composing a reply. This is deliberately a
    separate best-effort signal: failure must never suppress the real answer. */
export async function sendTyping(token: string, chatId: number | string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendChatAction`, {
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
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  const visibleText = sanitizePublicRuntimeText(text);
  const res = await fetch(`${API}/bot${token}/editMessageText`, {
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
  token: string,
  chatId: number | string,
  messageId: number,
  replyMarkup: TelegramInlineKeyboardMarkup = { inline_keyboard: [] },
): Promise<void> {
  const res = await fetch(`${API}/bot${token}/editMessageReplyMarkup`, {
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
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(callbackQueryId)) return;
  const res = await fetch(`${API}/bot${token}/answerCallbackQuery`, {
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
  token: string,
  chatId: number | string,
  messageId: number,
): Promise<void> {
  const res = await fetch(`${API}/bot${token}/deleteMessage`, {
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

  constructor(
    private readonly token: string,
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

  /** Native Hermes shows a persistent progress bubble when a tool starts.
      The API-server stream carries only its name and bounded preview—never
      full arguments or tool output—so this mirrors that visible event lane. */
  async showTool(tool: string, preview?: string): Promise<void> {
    try {
      await sendMessage(this.token, this.chatId, hermesToolLine(tool, preview));
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
  token: string,
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

export interface IncomingMessage {
  chatId: number;
  messageId: number;
  from: string;
  text: string;
  privateChat: boolean;
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
 * Returns null for everything else — edits, joins, stickers, channel
 * posts. Silence is correct: Telegram retries on a non-2xx, so
 * treating an unhandled update as an error would have it redelivered
 * forever.
 */
export function parseUpdate(body: unknown): IncomingMessage | null {
  if (typeof body !== 'object' || body === null) return null;
  const msg = (body as { message?: Record<string, unknown> }).message;
  if (!msg) return null;

  const chat = msg.chat as { id?: number; type?: string } | undefined;
  const from = msg.from as { first_name?: string; username?: string } | undefined;
  const text = msg.text;

  if (typeof chat?.id !== 'number' || typeof text !== 'string' || text.trim() === '') return null;
  if (typeof msg.message_id !== 'number') return null;

  return {
    chatId: chat.id,
    messageId: msg.message_id,
    from: from?.first_name ?? from?.username ?? 'Someone',
    // Long enough for a real question, short enough not to be a payload.
    text: text.slice(0, 4000),
    privateChat: chat.type === 'private',
  };
}

export interface WebhookHealth {
  url: string;
  pending: number;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Telegram will not deliver until this is cleared. */
  ip: string | null;
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
export async function webhookHealth(token: string): Promise<WebhookHealth> {
  const res = await fetch(`${API}/bot${token}/getWebhookInfo`, {
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
  };
}
