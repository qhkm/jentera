import type { Env } from '../env';
import { handleRuntimeQueueMessage } from './consumer';
import type { RuntimeQueueMessage, RuntimeQueueMessageResult, RuntimeTaskQueueMessage } from './consumer';
import type { RuntimeProvider } from './provider';

/**
 * Run one queue message where the database is close.
 *
 * Queue consumers and crons are not placed: measured 2026-09-10, the
 * consumer ran in LAX and SJC, the cron in IAD, and every tenant
 * transaction cost 1.1 to 2.3 s against Neon in Singapore. A service
 * binding to this same Worker invokes its fetch handler at the placed
 * location (`placement.region`): the same probe measured a 16 to 28 ms
 * database round trip inside the handler from either caller. A request to
 * the public hostname is not reliable for this (error 522 from IAD), so the
 * binding is the only route.
 *
 * The consumer therefore hands each message to `POST /api/support/runtime-slice`
 * through `env.SELF` and applies the result exactly as before. Anything
 * short of a well-formed result — binding missing, non-200, malformed body,
 * timeout — falls back to running the message here. The lease and dedupe
 * machinery in the consumer makes a repeated attempt harmless.
 */
export const PLACED_SLICE_PATH = '/api/support/runtime-slice';

/** A slice may run 13 minutes; the consumer invocation allows 15. */
const PLACED_SLICE_TIMEOUT_MS = 14 * 60 * 1_000;

export async function handleQueueMessagePlaced(
  env: Env,
  message: RuntimeQueueMessage,
  options: { provider?: RuntimeProvider; fetch?: typeof globalThis.fetch } = {},
): Promise<RuntimeQueueMessageResult & { placed: boolean }> {
  const key = env.AISAR_SUPPORT_KEY?.trim();
  /* Test seams (a fake provider or fetch) must run here, not remotely. */
  const delegable = Boolean(env.SELF && key && env.API_ORIGIN && !options.provider && !options.fetch);
  if (delegable) {
    try {
      const response = await env.SELF!.fetch(`${env.API_ORIGIN}${PLACED_SLICE_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(PLACED_SLICE_TIMEOUT_MS),
      });
      if (response.status === 200) {
        const result = queueMessageResult(await response.json().catch(() => null));
        if (result) return { ...result, placed: true };
        console.warn('[placed-slice] malformed result; running the message here');
      } else {
        console.warn(`[placed-slice] status ${response.status}; running the message here`);
      }
    } catch (error) {
      console.warn(`[placed-slice] ${error instanceof Error ? error.message : String(error)}; running the message here`);
    }
  }
  return { ...(await handleRuntimeQueueMessage(env, message, options)), placed: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only the reviewed shape crosses back; anything else is a fallback. */
export function queueMessageResult(value: unknown): RuntimeQueueMessageResult | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;
  let nextMessage: RuntimeTaskQueueMessage | undefined;
  if (body.nextMessage !== undefined) {
    const next = body.nextMessage as Record<string, unknown> | null;
    if (!next || next.version !== 1 || typeof next.businessId !== 'string' ||
        typeof next.taskId !== 'string' || !UUID.test(next.businessId) || !UUID.test(next.taskId)) {
      return null;
    }
    nextMessage = { version: 1, businessId: next.businessId, taskId: next.taskId };
  }
  if (body.action === 'ack') {
    if (!['completed', 'failed', 'already_done', 'missing'].includes(String(reason))) return null;
    return { action: 'ack', reason: reason as 'completed', ...(nextMessage ? { nextMessage } : {}) };
  }
  if (body.action === 'requeue' || body.action === 'retry') {
    if (reason === null || typeof body.delaySeconds !== 'number' || !Number.isFinite(body.delaySeconds)) {
      return null;
    }
    return {
      action: body.action,
      delaySeconds: Math.max(0, Math.min(3_600, Math.floor(body.delaySeconds))),
      reason,
      ...(nextMessage ? { nextMessage } : {}),
    };
  }
  return null;
}
