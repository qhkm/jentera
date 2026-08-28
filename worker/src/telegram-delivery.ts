import type { Env } from './env';
import { withTenant } from './db';
import { useCredential } from './connections';
import { sendMessage } from './connectors/telegram';
import { policyFor, type Policy } from './policy';
import { append, finishRun, recordWork, updateWorkForRun } from './runs';

export interface TelegramIncoming {
  chatId: number;
  messageId?: number;
  from: string;
  text: string;
}

/** Apply the policy at delivery time, not when generation started. An owner
    can therefore block sending while Hermes is still working. */
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
        objective: `Reply to ${incoming.from} on Telegram`,
        outcome: 'Blocked by your settings — nothing was sent',
        status: 'blocked',
        function: 'reply',
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
        objective: `Reply to ${incoming.from} on Telegram`,
        outcome: 'Waiting for you to approve the reply',
        status: 'needs_approval',
        function: 'reply',
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

/** Send, then preserve only the customer-visible result and structured audit. */
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
  const sent = await sendMessage(token, incoming.chatId, text);

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
        objective: `Reply to ${incoming.from} on Telegram`,
        outcome: text.slice(0, 500),
        status: 'completed',
        function: 'reply',
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
