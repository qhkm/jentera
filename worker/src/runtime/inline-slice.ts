import type { Env } from '../env';
import {
  handleRuntimeQueueMessage,
  scheduleRuntimeTaskWake,
} from './consumer';
import type { RuntimeQueueMessage } from './consumer';
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

/** Tests inject the provider, the runner fetch and a shorter slice. */
export interface InlineSliceOptions {
  provider?: RuntimeProvider;
  fetch?: typeof globalThis.fetch;
  observationSliceMs?: number;
}

/** waitUntil grants 30 s after the response. The slice stops at 20 s so its
    own finalisation (status load, usage, work record, next wake) fits. */
export const INLINE_SLICE_MS = 20_000;
/** If the inline slice dies with its invocation, the queue consumer finds
    the task by this delayed message and carries on. */
export const INLINE_SAFETY_NET_SECONDS = 30;

/** One consumer slice, run inline. The result is applied the way the queue
    handler applies it; a thrown error is logged and left to the delayed
    safety-net message. */
export async function runInlineSlice(
  env: Env,
  message: RuntimeQueueMessage,
  inline: InlineSliceOptions = {},
): Promise<void> {
  try {
    const result = await handleRuntimeQueueMessage(env, message, {
      ...inline,
      observationSliceMs: inline.observationSliceMs ?? INLINE_SLICE_MS,
    });
    if (result.action === 'ack') return;
    const wake = result.nextMessage ?? (message.version === 1 ? message : null);
    if (wake) {
      await scheduleRuntimeTaskWake(env, wake.businessId, wake.taskId, result.delaySeconds);
    } else if (env.RUNTIME_QUEUE) {
      /* Intake that did not reach admission (busy sibling, credential
         maintenance): the queue repeats the intake itself. */
      await env.RUNTIME_QUEUE.send(message, { delaySeconds: Math.max(1, result.delaySeconds) });
    }
  } catch (error) {
    console.error(`[inline-slice] failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
