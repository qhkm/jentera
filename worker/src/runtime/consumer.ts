/* ============================================================
   Queue delivery for runtime work.

   The queue is a wake-up signal; runtime_task is the durable truth.
   Every message therefore acquires a database lease before touching
   provider compute. Duplicate delivery after completion is an ack.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import { ensureProviderRuntime } from './provision';
import type { RuntimeProvider } from './provider';
import {
  completeRuntimeTask,
  deferRuntimeTask,
  enqueueRuntimeTask,
  leaseRuntimeTask,
  retryRuntimeTask,
  type RuntimeTask,
  type RuntimeTaskKind,
} from './tasks';
import { append, finishRun, recordWork } from '../runs';
import { dispatchRuntimeRun } from './run-task';

export interface RuntimeQueueMessage {
  version: 1;
  businessId: string;
  taskId: string;
}

export type RuntimeMessageResult =
  | { action: 'ack'; reason: 'completed' | 'already_done' | 'missing' }
  | { action: 'requeue'; delaySeconds: number; reason: string }
  | { action: 'retry'; delaySeconds: number; reason: string };

export async function publishRuntimeTask(
  env: Env,
  businessId: string,
  input: {
    kind: RuntimeTaskKind;
    runId?: string | null;
    payload?: unknown;
    dedupeKey: string;
  },
): Promise<RuntimeTask> {
  if (!env.RUNTIME_QUEUE) throw new Error('RUNTIME_QUEUE is not configured');
  const task = await withTenant(env, businessId, (tx) =>
    enqueueRuntimeTask(tx, businessId, input),
  );
  await env.RUNTIME_QUEUE.send({ version: 1, businessId, taskId: task.id });
  return task;
}

export async function handleRuntimeMessage(
  env: Env,
  message: RuntimeQueueMessage,
  options: { provider?: RuntimeProvider; fetch?: typeof globalThis.fetch } = {},
): Promise<RuntimeMessageResult> {
  if (message.version !== 1 || !uuid(message.businessId) || !uuid(message.taskId)) {
    return { action: 'ack', reason: 'missing' };
  }

  const leaseToken = crypto.randomUUID();
  const lease = await withTenant(env, message.businessId, (tx) =>
    leaseRuntimeTask(tx, message.businessId, message.taskId, leaseToken),
  );

  if (lease.outcome === 'missing') return { action: 'ack', reason: 'missing' };
  if (lease.outcome === 'done') return { action: 'ack', reason: 'already_done' };
  if (lease.outcome === 'busy') {
    return { action: 'retry', delaySeconds: 10, reason: 'business runtime is busy' };
  }

  try {
    switch (lease.task.kind) {
      case 'provision':
      case 'reconcile':
        await ensureProviderRuntime(env, message.businessId, { provider: options.provider });
        break;
      case 'run': {
        const outcome = await dispatchRuntimeRun(env, lease.task, leaseToken, options);
        if (outcome.state === 'pending') {
          const deferred = await withTenant(env, message.businessId, async (tx) => {
            if (!lease.task.remoteRunId && lease.task.runId) {
              await append(tx, message.businessId, lease.task.runId, 'work.started', {
                runtimeTaskId: lease.task.id,
                remoteRunId: outcome.remoteRunId,
              });
            }
            return deferRuntimeTask(tx, message.businessId, message.taskId, leaseToken, {
              remoteRunId: outcome.remoteRunId,
              remoteStatus: outcome.remoteStatus,
            });
          });
          if (!deferred) {
            return { action: 'retry', delaySeconds: 10, reason: 'runtime task lease was lost' };
          }
          return { action: 'requeue', delaySeconds: 5, reason: 'Hermes run is still active' };
        }

        const completed = await withTenant(env, message.businessId, async (tx) => {
          if (!lease.task.remoteRunId && lease.task.runId) {
            await append(tx, message.businessId, lease.task.runId, 'work.started', {
              runtimeTaskId: lease.task.id,
              remoteRunId: outcome.remoteRunId,
            });
          }
          const done = await completeRuntimeTask(
            tx,
            message.businessId,
            message.taskId,
            leaseToken,
            {
              remoteRunId: outcome.remoteRunId,
              remoteStatus: outcome.remoteStatus,
              result: outcome.result,
            },
          );
          if (!done || !lease.task.runId) return done;
          const successful = outcome.remoteStatus === 'completed';
          await recordWork(tx, message.businessId, {
            runId: lease.task.runId,
            objective: outcome.payload.objective ?? outcome.payload.input.slice(0, 1_000),
            outcome: outcome.summary,
            status: successful ? 'completed' : 'failed',
            function: outcome.payload.function ?? 'agent',
            channel: outcome.payload.channel ?? 'runtime',
            risk: 'low',
          });
          await finishRun(
            tx,
            message.businessId,
            lease.task.runId,
            successful ? 'completed' : 'failed',
            { runtimeTaskId: lease.task.id, remoteStatus: outcome.remoteStatus },
          );
          return true;
        });
        if (!completed) {
          return { action: 'retry', delaySeconds: 10, reason: 'runtime task lease was lost' };
        }
        return { action: 'ack', reason: 'completed' };
      }
      default:
        throw new Error(`runtime task ${lease.task.kind} is not implemented`);
    }

    const completed = await withTenant(env, message.businessId, (tx) =>
      completeRuntimeTask(tx, message.businessId, message.taskId, leaseToken),
    );
    if (!completed) {
      return { action: 'retry', delaySeconds: 10, reason: 'runtime task lease was lost' };
    }
    return { action: 'ack', reason: 'completed' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await withTenant(env, message.businessId, (tx) =>
      retryRuntimeTask(tx, message.businessId, message.taskId, leaseToken, reason),
    );
    return { action: 'retry', delaySeconds: 30, reason };
  }
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
