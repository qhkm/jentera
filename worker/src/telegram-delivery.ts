import type { Env } from './env';
import { withTenant } from './db';
import { useCredential } from './connections';
import { hermesDraftId, sendHermesMessage, TelegramDraftStream } from './connectors/telegram';
import { policyFor, type Policy } from './policy';
import { append, finishRun, recordWork, updateWorkForRun } from './runs';

export interface TelegramIncoming {
  chatId: number;
  messageId?: number;
  from: string;
  text: string;
  privateChat?: boolean;
}

/** Deliver a Telegram response. Internal paired chats pass a known automatic
    policy because replying to the authenticated owner is not a customer-facing
    action; legacy customer drafts still resolve the owner's send policy here. */
export async function deliverTelegramDraft(
  env: Env,
  businessId: string,
  connectionId: string,
  runId: string,
  incoming: TelegramIncoming,
  text: string,
  usedKeys: string[],
  knownPolicy?: Policy,
  existingToken?: string,
): Promise<'sent' | 'needs_approval' | 'blocked'> {
  const policy = knownPolicy ?? await withTenant(
    env,
    businessId,
    (tx) => policyFor(tx, 'telegram', 'send_message'),
  );

  await withTenant(env, businessId, (tx) =>
    append(tx, businessId, runId, 'action.proposed', {
      connector: 'telegram',
      op: 'send_message',
      chatId: incoming.chatId,
    }),
  );

  if (policy === 'blocked') {
    await withTenant(env, businessId, async (tx) => {
      await recordWork(tx, businessId, {
        runId,
        objective: `Help ${incoming.from} on Telegram`,
        outcome: 'Blocked by your settings — nothing was sent',
        status: 'blocked',
        function: 'assistant',
        channel: 'telegram',
        subject: incoming.text.slice(0, 200),
        risk: 'medium',
      });
      await finishRun(tx, businessId, runId, 'cancelled', { reason: 'blocked' });
    });
    return 'blocked';
  }

  if (policy !== 'automatic') {
    await withTenant(env, businessId, async (tx) => {
      const [approval] = await tx<{ id: string }[]>`
        insert into approval (business_id, connector, op, args, risk)
        values (${businessId}, 'telegram', 'send_message',
                ${tx.json({
                  chatId: incoming.chatId,
                  connectionId,
                  from: incoming.from,
                  question: incoming.text,
                  draft: text,
                } as never)}, 'medium')
        returning id`;
      await recordWork(tx, businessId, {
        runId,
        objective: `Help ${incoming.from} on Telegram`,
        outcome: 'Waiting for you to approve the reply',
        status: 'needs_approval',
        function: 'assistant',
        channel: 'telegram',
        subject: incoming.text.slice(0, 200),
        risk: 'medium',
        approvalId: approval.id,
        inputsUsed: { factKeys: usedKeys },
      });
      await finishRun(tx, businessId, runId, 'needs_approval', { approvalId: approval.id });
    });
    return 'needs_approval';
  }

  await sendAndRecord(
    env,
    businessId,
    connectionId,
    runId,
    incoming,
    text,
    usedKeys,
    existingToken,
  );
  return 'sent';
}

/** Send, then preserve only the user-visible result and structured audit. */
export async function sendAndRecord(
  env: Env,
  businessId: string,
  connectionId: string,
  runId: string,
  incoming: TelegramIncoming,
  text: string,
  usedKeys: string[],
  existingToken?: string,
): Promise<void> {
  const token = existingToken ??
    await withTenant(env, businessId, (tx) => useCredential(env, tx, connectionId));
  const sent = await sendHermesMessage(token, incoming.chatId, text);

  await withTenant(env, businessId, async (tx) => {
    await append(tx, businessId, runId, 'action.executed', {
      connector: 'telegram',
      messageId: sent.messageId,
    });
    const amended = await updateWorkForRun(tx, businessId, runId, {
      status: 'completed',
      outcome: text,
      minutesSaved: 3,
    });
    if (!amended) {
      await recordWork(tx, businessId, {
        runId,
        objective: `Help ${incoming.from} on Telegram`,
        outcome: text.slice(0, 500),
        status: 'completed',
        function: 'assistant',
        channel: 'telegram',
        subject: incoming.text.slice(0, 200),
        risk: 'medium',
        minutesSaved: 3,
        inputsUsed: { factKeys: usedKeys },
      });
    }
    await tx`update connection set last_ok_at = now() where id = ${connectionId}`;
    await finishRun(tx, businessId, runId, 'completed', { messageId: sent.messageId });
  });
}

/** The live Telegram draft id is derived from the owning runtime task. */
function telegramPayloadHint(value: unknown): {
  connectionId: string;
  chatId: number;
  privateChat: boolean;
} | null {
  if (!value || typeof value !== 'object') return null;
  const telegram = (value as Record<string, unknown>).telegram;
  if (!telegram || typeof telegram !== 'object') return null;
  const t = telegram as Record<string, unknown>;
  if (typeof t.connectionId !== 'string' || typeof t.chatId !== 'number') return null;
  return {
    connectionId: t.connectionId,
    chatId: t.chatId,
    privateChat: t.privateChat === true,
  };
}

/**
 * An owner cancel freezes the ephemeral Telegram draft mid-thought — the chat
 * sits on "⏳ Working…" (or "⏳ In line…") forever because the run is terminal
 * and nothing will ever replace it. Settle it with a short visible note.
 *
 * When `payload` is supplied (the cancel caller already has the row) no extra
 * query is made; otherwise the target task's payload is read from the durable
 * row, which is not scrubbed because cancellation flips it terminal directly.
 *
 * Cosmetic only: every failure is caught so a draft hiccup can never fail the
 * cancel task or the cancel request itself.
 */
export async function settleCancelledDraft(
  env: Env,
  businessId: string,
  taskId: string,
  payload?: unknown,
): Promise<void> {
  try {
    let telegram = telegramPayloadHint(payload);
    if (!telegram && payload === undefined) {
      const [row] = await withTenant(env, businessId, (tx) =>
        tx<{ payload: unknown }[]>`select payload from runtime_task where id = ${taskId} limit 1`);
      telegram = telegramPayloadHint(row?.payload);
    }
    if (!telegram?.privateChat) return;
    const token = await withTenant(env, businessId, (tx) =>
      useCredential(env, tx, telegram.connectionId));
    const stream = new TelegramDraftStream(token, telegram.chatId, hermesDraftId(taskId));
    await stream.push('⚠️ Cancelled — this request was stopped.');
  } catch (error) {
    console.warn(
      '[runtime] cancelled draft note failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}
