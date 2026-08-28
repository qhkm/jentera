/* ============================================================
   Telegram, via a bot token the business owner supplies.

   Each business connects its own bot. That is not incidental: a shared
   bot would put every customer conversation from every business
   through one identity, and messages would arrive from a name that is
   not the business's own. The owner's bot is their brand, their
   customers, and their token to revoke.

   The token never leaves the vault except to be used. It is not
   logged, not returned by any endpoint, and not shown back to the
   owner after it is saved.
   ============================================================ */

const API = 'https://api.telegram.org';

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
      allowed_updates: ['message'],
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
): Promise<{ messageId: number }> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
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

/** Hermes final replies use Telegram's native rich-message lane. Rich Markdown
    accepts the model's GitHub-flavoured Markdown without the destructive
    escaping required by MarkdownV2. A bot/API combination that cannot render
    it gets the ordinary text message instead. */
export async function sendHermesMessage(
  token: string,
  chatId: number | string,
  text: string,
): Promise<{ messageId: number }> {
  const res = await fetch(`${API}/bot${token}/sendRichMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      rich_message: { markdown: text },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  } | null;
  if (body?.ok && body.result?.message_id) return { messageId: body.result.message_id };
  if (res.status === 400 || res.status === 404) return sendMessage(token, chatId, text);
  throw new Error(body?.description ?? 'Telegram would not deliver that message');
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

/** Telegram's ephemeral private-chat streaming preview. The same non-zero
    draft id replaces the prior preview; sendMessage persists the final text. */
export async function sendMessageDraft(
  token: string,
  chatId: number | string,
  draftId: number,
  text: string,
): Promise<void> {
  if (!Number.isSafeInteger(draftId) || draftId === 0) throw new Error('draft id is invalid');
  const rich = text
    ? { markdown: balanceStreamingMarkdown(text) }
    : { html: '<tg-thinking>Thinking...</tg-thinking>' };
  const richRes = await fetch(`${API}/bot${token}/sendRichMessageDraft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, draft_id: draftId, rich_message: rich }),
    signal: AbortSignal.timeout(5_000),
  });
  const richBody = (await richRes.json().catch(() => null)) as { ok?: boolean } | null;
  if (richBody?.ok) return;
  if (richRes.status !== 400 && richRes.status !== 404) {
    throw new Error('Telegram refused the live draft');
  }

  const plainRes = await fetch(`${API}/bot${token}/sendMessageDraft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, draft_id: draftId, text }),
    signal: AbortSignal.timeout(5_000),
  });
  const plainBody = (await plainRes.json().catch(() => null)) as { ok?: boolean } | null;
  if (!plainBody?.ok) throw new Error('Telegram refused the live draft');
}

/** A UUID-backed 49-bit identity mirrors Hermes's collision-resistant draft
    ids while remaining exactly representable by JavaScript and Telegram. */
export function hermesDraftId(taskId: string): number {
  // The UUID tail contains only random bits; the front contains fixed version
  // bits, which would reduce the collision resistance Hermes relies on.
  const hex = taskId.replaceAll('-', '').slice(-13);
  if (!/^[0-9a-f]{13}$/i.test(hex)) throw new Error('runtime task id is invalid');
  const id = Number(BigInt(`0x${hex}`) & ((1n << 49n) - 1n));
  return id || 1;
}

/** Coalesce model tokens into Telegram-safe cumulative drafts. It stores text
    only in this Worker invocation and never emits more than about one update
    per second, inside Telegram's documented per-peer limits. */
export class TelegramDraftStream {
  private text = '';
  private sent = '';
  private lastSentAt = 0;
  private lastTypingAt = 0;
  private available = true;
  private typingAvailable = true;

  constructor(
    private readonly token: string,
    private readonly chatId: number | string,
    private readonly draftId: number,
  ) {}

  async push(delta: string): Promise<void> {
    if (!this.available || !delta) return;
    this.text = `${this.text}${delta}`.slice(0, 4_000);
    if (this.text === this.sent) return;
    const elapsed = Date.now() - this.lastSentAt;
    const buffered = this.text.length - this.sent.length;
    if (this.lastSentAt !== 0 && elapsed < 800 && buffered < 24) return;
    await this.publish();
  }

  async flush(): Promise<void> {
    if (!this.available || this.text === this.sent) return;
    await this.publish();
  }

  async heartbeat(): Promise<void> {
    await this.pulseTyping();
    if (!this.available || Date.now() - this.lastSentAt < 15_000) return;
    await this.publish();
  }

  /** Keep Telegram's separate chat-level typing affordance visible while the
      ephemeral Hermes draft is active. Draft support and typing support fail
      independently so a cosmetic rejection cannot disable the other lane. */
  async pulseTyping(force = false): Promise<void> {
    if (!this.typingAvailable || (!force && Date.now() - this.lastTypingAt < 4_000)) return;
    this.lastTypingAt = Date.now();
    try {
      await sendTyping(this.token, this.chatId);
    } catch {
      this.typingAvailable = false;
    }
  }

  private async publish(): Promise<void> {
    try {
      await sendMessageDraft(this.token, this.chatId, this.draftId, this.text);
      this.sent = this.text;
      this.lastSentAt = Date.now();
      await this.pulseTyping();
    } catch {
      /* Preview support is cosmetic and private-chat-only. A failure disables
         this stream but never suppresses the durable final reply. */
      this.available = false;
    }
  }
}

/** Hermes balances incomplete code spans in Telegram previews so a partial
    model chunk does not make the rest of the draft render as code. */
function balanceStreamingMarkdown(text: string): string {
  let balanced = text;
  if ((balanced.match(/```/g)?.length ?? 0) % 2 === 1) {
    balanced = `${balanced.replace(/\s+$/, '')}\n\`\`\``;
  }
  const withoutFences = balanced
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```[^`]*$/g, '');
  if ((withoutFences.match(/`/g)?.length ?? 0) % 2 === 1) balanced = `${balanced}\``;
  return balanced;
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
