import { withTenant } from '../db';
import type { Env } from '../env';
import {
  handleRuntimeQueueMessage,
  scheduleRuntimeTaskWake,
} from './consumer';
import type { RuntimeQueueMessage, RuntimeTaskQueueMessage } from './consumer';
import { publishRunProgressSafely } from './progress';
import type { RuntimeProvider } from './provider';

/**
 * The first slice of a run, executed by the HTTP handler that received the
 * message instead of by the queue consumer.
 *
 * The HTTP handler is placed next to the database (`placement.region`); the
 * queue consumer is not, and every tenant transaction cost it 1.1 to 2.3 s —
 * a "yob" waited 12 to 16 s before Hermes was even asked (Workers Logs,
 * 2026-09-10). An HTTP invocation has no wall-time limit and `waitUntil`
 * grants 30 s after the response, so the intake leases, dispatches and
 * relays the first slice here. The queue receives the same message with a
 * delay, as the safety net: if the slice dies with its invocation, the
 * consumer finds the task and carries on from `runtime_task.stream_seq`.
 */

/** Something that outlives the response: `ctx.waitUntil` in production. */
export interface BackgroundContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Tests inject the provider, the runner fetch and shorter timings. */
export interface InlineSliceOptions {
  provider?: RuntimeProvider;
  fetch?: typeof globalThis.fetch;
  observationSliceMs?: number;
  busyPollMs?: number;
}

/** waitUntil grants 30 s after the response. The slice stops at 20 s so its
    own finalisation (status load, usage, work record, next wake) fits. */
export const INLINE_SLICE_MS = 20_000;
/** If the inline slice dies with its invocation, the queue consumer finds
    the task by this delayed message and carries on. */
export const INLINE_SAFETY_NET_SECONDS = 30;

/** A business runs one reply at a time. While the previous one is still
    running, the slice polls for the slot this often instead of handing the
    message to the queue's watchdog. */
const INLINE_BUSY_POLL_MS = 1_000;
/** Do not start a dispatch with less of the budget left than this; hand
    over instead, so the run is never started by an invocation about to die. */
const INLINE_MIN_DISPATCH_MS = 4_000;
const WAITING_FOR_SLOT = /queued behind an active run|recheck a stale lease/;
const WAITING_STATUS = '⏳ Finishing your previous message first…';

/** One consumer slice, run inline. The result is applied the way the queue
    handler applies it; a thrown error is logged and left to the delayed
    safety-net message. A message that arrives while the previous reply is
    still running waits for the slot here (a "yob" sent behind another
    message took 18.6 s to reach Hermes through the queue on 2026-09-10,
    its neighbours 1.0 to 1.3 s) and tells the owner why. */
export async function runInlineSlice(
  env: Env,
  first: RuntimeQueueMessage,
  inline: InlineSliceOptions = {},
): Promise<void> {
  const startedAt = Date.now();
  const budgetMs = inline.observationSliceMs ?? INLINE_SLICE_MS;
  const pollMs = inline.busyPollMs ?? INLINE_BUSY_POLL_MS;
  let message = first;
  let toldOwner = false;
  try {
    for (;;) {
      const remainingMs = budgetMs - (Date.now() - startedAt);
      const result = await handleRuntimeQueueMessage(env, message, {
        ...inline,
        observationSliceMs: Math.max(INLINE_MIN_DISPATCH_MS, remainingMs),
      });
      if (result.action === 'ack') return;
      /* Intake is converted to its durable task on admission; wait on that. */
      if (result.nextMessage) message = result.nextMessage;
      const waiting = result.action === 'requeue' && WAITING_FOR_SLOT.test(result.reason);
      if (waiting && remainingMs - pollMs > INLINE_MIN_DISPATCH_MS) {
        if (!toldOwner && message.version === 1) {
          toldOwner = true;
          await tellOwnerWaiting(env, message);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      if (message.version === 1) {
        await scheduleRuntimeTaskWake(env, message.businessId, message.taskId, result.delaySeconds);
      } else if (env.RUNTIME_QUEUE) {
        /* Intake that did not reach admission (credential maintenance, an
           unready runtime): the queue repeats the intake itself. */
        await env.RUNTIME_QUEUE.send(message, { delaySeconds: Math.max(1, result.delaySeconds) });
      }
      return;
    }
  } catch (error) {
    console.error(`[inline-slice] failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function tellOwnerWaiting(env: Env, message: RuntimeTaskQueueMessage): Promise<void> {
  const runId = await withTenant(env, message.businessId, async (tx) => {
    const [row] = await tx<{ run_id: string | null }[]>`
      select run_id from runtime_task where id = ${message.taskId}`;
    return row?.run_id ?? null;
  }).catch(() => null);
  if (runId) {
    await publishRunProgressSafely(env, message.businessId, runId, 'status', { detail: WAITING_STATUS });
  }
}
