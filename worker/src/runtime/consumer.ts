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
  exhaustRuntimeTask,
  leaseRuntimeTask,
  nextWaitingRuntimeTaskId,
  renewRuntimeTaskLease,
  retryRuntimeTask,
  type RuntimeTask,
  type RuntimeTaskKind,
} from './tasks';
import { finishRun, recordWork } from '../runs';
import { dispatchRuntimeRun, measuredUsageOf, stopRuntimeTask } from './run-task';
import { finalizeRuntimeUsage, RuntimeBudgetExceeded } from './usage';
import { deleteRuntime, reconcileRuntime, upgradeRuntime } from './lifecycle';
import { publishRunProgressSafely } from './progress';
import { deliverTelegramDraft, deleteTelegramLiveBubble, persistLiveMessageId, settleCancelledDraft } from '../telegram-delivery';
import { useCredential } from '../connections';
import { hermesToolLine, sendTyping, TelegramLiveStream } from '../connectors/telegram';
import { runtimeModelKeyNeedsRotation } from './openrouter-keys';
import { RuntimeBusyError } from './runner-client';
import { getRuntime } from '../agent-runtime';
import { runtimeReady } from './execution';

const MAX_TASK_ATTEMPTS = 5;
const BUSY_RETRY_SECONDS = 2;

/** Friendly one-line statuses for the ephemeral Telegram draft, keyed by the
    run-task provisioning stages. Shown only while the model has produced no
    answer text yet — they make the cold-start window feel alive without ever
    surfacing reasoning content (the anti-CoT scrubber stays untouched).
    The only deliberate exception is the live `thinking` lane: bounded slices of
    real CoT render in the ephemeral bubble status and are cleared/never saved
    once the answer starts — the durable answer and the app output stay CoT-free. */
const STAGE_STATUS: Record<string, string> = {
  database_ready: '✅ System ready — waking AI…',
  provider_awake: '✅ AI engine online — starting agent…',
  runner_ready: '✅ Agent runtime ready — connecting…',
  hermes_started: '✅ Agent started — thinking…',
  run_recorded: '⏳ Researching…',
};

export interface RuntimeQueueMessage {
  version: 1;
  businessId: string;
  taskId: string;
}

export type RuntimeMessageResult =
  | { action: 'ack'; reason: 'completed' | 'failed' | 'already_done' | 'missing' }
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
  await signalRuntimeTask(env, businessId, task.id);
  return task;
}

export async function signalRuntimeTask(
  env: Env,
  businessId: string,
  taskId: string,
): Promise<void> {
  if (!env.RUNTIME_QUEUE) throw new Error('RUNTIME_QUEUE is not configured');
  await env.RUNTIME_QUEUE.send({ version: 1, businessId, taskId });
}

/** Signal the oldest waiting task now that a slot just freed — the FIFO
    wake that makes new messages behave like a Hermes session queue instead
    of a racy poll. Safe to fire from any terminal path: the lease CAS and
    the NOT EXISTS sibling guard let exactly one waiting task win. */
export async function wakeNextRuntimeTask(
  env: Env,
  businessId: string,
): Promise<void> {
  const nextId = await withTenant(env, businessId, (tx) =>
    nextWaitingRuntimeTaskId(tx, businessId));
  if (nextId) await signalRuntimeTask(env, businessId, nextId).catch(() => {});
}

export async function handleRuntimeMessage(
  env: Env,
  message: RuntimeQueueMessage,
  options: { provider?: RuntimeProvider; fetch?: typeof globalThis.fetch } = {},
): Promise<RuntimeMessageResult> {
  const messageStartedAt = Date.now();
  /* The live Telegram bubble from this delivery slice, hoisted so the
     terminal-failure path can tidy it even if the persisted payload was
     scrubbed by exhaustion. */
  let liveBubbleId: number | undefined;
  if (message.version !== 1 || !uuid(message.businessId) || !uuid(message.taskId)) {
    return { action: 'ack', reason: 'missing' };
  }

  const leaseToken = crypto.randomUUID();
  const leaseStartedAt = Date.now();
  const lease = await withTenant(env, message.businessId, (tx) =>
    leaseRuntimeTask(tx, message.businessId, message.taskId, leaseToken),
  );
  const leaseMs = Date.now() - leaseStartedAt;

  if (lease.outcome === 'missing') return { action: 'ack', reason: 'missing' };
  if (lease.outcome === 'done') return { action: 'ack', reason: 'already_done' };
  if (lease.outcome === 'busy') {
    /* The task is already parked in runtime_task (durable truth) while a
       sibling holds the slot. Wake-on-release will signal it the moment the
       slot frees, so this requeue is only a watchdog — schedule it against
       the sibling's lease horizon instead of hammering the queue every 2s. */
    const remainingMs = lease.siblingLeaseExpiresAt
      ? Math.max(0, new Date(lease.siblingLeaseExpiresAt).getTime() - Date.now())
      : 0;
    const delaySeconds = Math.min(Math.max(Math.ceil(remainingMs / 1_000) + 5, 15), 120);
    return {
      action: 'requeue',
      delaySeconds,
      reason: 'business runtime is busy — queued behind an active run',
    };
  }

  if (lease.task.kind === 'run' && lease.task.runId) {
    await publishRunProgressSafely(
      env,
      message.businessId,
      lease.task.runId,
      lease.task.remoteRunId ? 'working' : 'waking',
    );
  }

  try {
    let lifecycleResult: { region: string | null } | undefined;
    /* Work admitted against a healthy older release must wait for the current
       immutable bundle. This preserves the user's request while ensuring it
       cannot run on a Sprite that lacks the newly required search attestation. */
    if (lease.task.kind === 'run') {
      const runtime = await withTenant(env, message.businessId, (tx) =>
        getRuntime(tx, message.businessId));
      const release = env.RUNTIME_RELEASE?.trim();
      if (runtime && release &&
          (runtime.desiredRelease !== release || runtime.observedRelease !== release)) {
        await publishRuntimeTask(env, message.businessId, {
          kind: 'upgrade',
          dedupeKey: `upgrade:${message.businessId}:${release}`,
          payload: { release, reason: 'release_drift' },
        });
        const deferred = await withTenant(env, message.businessId, (tx) =>
          deferRuntimeTask(tx, message.businessId, message.taskId, leaseToken, {
            delaySeconds: 30,
          }));
        return deferred
          ? { action: 'requeue', delaySeconds: 30, reason: 'runtime release upgrade' }
          : { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
      }
    }

    /* Key maintenance is tenant-local and demand-driven. This avoids a fleet
       scan whose cost grows with every signup: the first run inside the
       seven-day rotation window yields to one deduplicated upgrade, then
       resumes automatically with the proven replacement credential. */
    if (lease.task.kind === 'run' &&
        await runtimeModelKeyNeedsRotation(env, message.businessId)) {
      const day = Math.floor(Date.now() / (24 * 60 * 60 * 1_000));
      await publishRuntimeTask(env, message.businessId, {
        kind: 'upgrade',
        dedupeKey: `model-key-rotation:${message.businessId}:${day}`,
        payload: { reason: 'model_key_rotation' },
      });
      const deferred = await withTenant(env, message.businessId, (tx) =>
        deferRuntimeTask(tx, message.businessId, message.taskId, leaseToken, {
          delaySeconds: 30,
        }));
      return deferred
        ? { action: 'requeue', delaySeconds: 30, reason: 'runtime credential maintenance' }
        : { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
    }

    switch (lease.task.kind) {
      case 'provision':
        lifecycleResult = runtimeDiagnostic(await ensureProviderRuntime(env, message.businessId, {
          provider: options.provider,
          fetch: options.fetch,
        }));
        break;
      case 'reconcile':
        lifecycleResult = runtimeDiagnostic(await reconcileRuntime(
          env, message.businessId, options.provider, options.fetch,
        ));
        break;
      case 'upgrade':
        {
          const satisfied = await satisfiedReleaseRepair(
            env, message.businessId, lease.task,
          );
          if (satisfied) {
            lifecycleResult = runtimeDiagnostic(satisfied);
          } else {
            lifecycleResult = runtimeDiagnostic(await upgradeRuntime(
              env, message.businessId, options.provider, options.fetch,
            ));
          }
        }
        break;
      case 'delete':
        await deleteRuntime(env, message.businessId, options.provider);
        break;
      case 'cancel': {
        const payload = lease.task.payload as { targetTaskId?: unknown };
        if (typeof payload?.targetTaskId !== 'string' || !uuid(payload.targetTaskId)) {
          throw new Error('runtime cancel target is invalid');
        }
        let stopped: Awaited<ReturnType<typeof stopRuntimeTask>> = null;
        try {
          stopped = await stopRuntimeTask(
            env, message.businessId, payload.targetTaskId, options.fetch,
          );
        } catch (error) {
          /* A cold/unreachable sprite stop must not skip finalization — the
             reservation would otherwise strand forever against the monthly
             budget (see the 97002811 leak). Finalize with measured usage when
             the runner answered, else zero; the runner-side stop is retried
             by re-delivery of this control task. */
          console.warn('[runtime] cancel stop failed; finalizing usage anyway', error);
        }
        await withTenant(env, message.businessId, (tx) => finalizeRuntimeUsage(
          tx,
          message.businessId,
          payload.targetTaskId as string,
          'cancelled',
          stopped ? measuredUsageOf(stopped) ?? { inputTokens: 0, outputTokens: 0 }
            : { inputTokens: 0, outputTokens: 0 },
        ));
        await settleCancelledDraft(env, message.businessId, payload.targetTaskId as string);
        break;
      }
      case 'run': {
        const latency = (stage: string, dispatchElapsedMs?: number, extra: Record<string, unknown> = {}) => {
          console.info('[runtime-latency]', JSON.stringify({
            stage,
            queueElapsedMs: Date.now() - messageStartedAt,
            ...(dispatchElapsedMs === undefined ? {} : { dispatchElapsedMs }),
            ...extra,
            channel: telegramHint(lease.task.payload) ? 'telegram' : 'app',
          }));
        };
        latency('leased', undefined, { leaseMs });
        const liveStream = await telegramLiveStream(env, lease.task);
        liveBubbleId = liveStream?.id;
        const toolShown = new Set<string>();
        await liveStream?.pulseTyping(true);
        let lastLeaseRenewal = Date.now();
        let firstVisibleDelta = false;
        let statusTimer: ReturnType<typeof setInterval> | undefined;
        /* Last live `@step:` narration (or tool line) shown in the working
           bubble. Rendered with the elapsed ticker until the answer starts. */
        let currentStep = '';
        let currentStepIsTool = false;
        const workingSince = Date.now();
        if (liveStream) {
          void liveStream.setStatus('⏳ On it — waking the AI…');
          statusTimer = setInterval(() => {
            if (firstVisibleDelta) return;
            const elapsed = Math.round((Date.now() - workingSince) / 1_000);
            void liveStream.setStatus(currentStep
              ? `${currentStep} · ${elapsed}s`
              : `⏳ Working… (${elapsed}s)`);
          }, 5_000);
        }
        const outcome = await dispatchRuntimeRun(env, lease.task, leaseToken, {
          ...options,
          onDelta: liveStream
            ? async (delta) => {
                if (!firstVisibleDelta && delta.trim()) {
                  firstVisibleDelta = true;
                  latency('first_visible_delta');
                }
                await liveStream.push(delta);
              }
            : undefined,
          onToolEvent: liveStream
            ? async (event) => {
                if (event.type !== 'tool.started' && event.type !== 'tool.completed') {
                  return;
                }
                if (event.type === 'tool.started') {
                  if (!toolShown.has(event.tool)) {
                    toolShown.add(event.tool);
                    await liveStream.showTool(event.tool, event.preview);
                  }
                  /* Mirror the tool into the working bubble while no answer
                     text exists yet, so the bubble itself stays alive. */
                  if (!currentStep && !firstVisibleDelta) {
                    currentStep = hermesToolLine(event.tool, event.preview);
                    currentStepIsTool = true;
                    const elapsed = Math.round((Date.now() - workingSince) / 1_000);
                    await liveStream.setStatus(`${currentStep} · ${elapsed}s`);
                  }
                } else if (currentStepIsTool) {
                  currentStep = '';
                  currentStepIsTool = false;
                }
              }
            : undefined,
          onHeartbeat: liveStream
            ? async () => {
                await liveStream.heartbeat();
                if (Date.now() - lastLeaseRenewal < 60_000) return;
                const renewed = await withTenant(env, message.businessId, (tx) =>
                  renewRuntimeTaskLease(
                    tx,
                    message.businessId,
                    message.taskId,
                    leaseToken,
                  ));
                if (!renewed) throw new Error('runtime task lease was lost while streaming');
                lastLeaseRenewal = Date.now();
              }
            : undefined,
          onProgress: liveStream
            ? async (label) => {
                currentStep = label;
                currentStepIsTool = false;
                if (!firstVisibleDelta) {
                  const elapsed = Math.round((Date.now() - workingSince) / 1_000);
                  await liveStream.setStatus(`${label} · ${elapsed}s`);
                }
              }
            : undefined,
          onThinking: liveStream
            ? async (text) => {
                /* Live reasoning: the runner forwards the model's actual CoT as
                   a bounded `thinking` lane. Render it in the ephemeral bubble
                   status exactly like `@step:` narration — it is cleared the
                   moment the first answer delta lands and never enters the
                   durable answer lane (the runner keeps it out of `output`). */
                if (firstVisibleDelta) return;
                const thinking = sanitiseThinking(text);
                if (!thinking) return;
                currentStep = thinking;
                currentStepIsTool = false;
                const elapsed = Math.round((Date.now() - workingSince) / 1_000);
                await liveStream.setStatus(`${thinking} · ${elapsed}s`);
              }
            : undefined,
          onStage: (stage, elapsedMs) => {
            latency(stage, elapsedMs);
            const status = STAGE_STATUS[stage];
            if (status) void liveStream?.setStatus(status);
          },
        });
        if (statusTimer) {
          clearInterval(statusTimer);
          statusTimer = undefined;
        }
        latency(outcome.state === 'terminal' ? 'terminal' : 'pending');
        if (outcome.state === 'pending') {
          const deferred = await withTenant(env, message.businessId, async (tx) => {
            return deferRuntimeTask(tx, message.businessId, message.taskId, leaseToken, {
              remoteRunId: outcome.remoteRunId,
              remoteStatus: outcome.remoteStatus,
            });
          });
          if (!deferred) {
            await stopRuntimeTask(env, message.businessId, message.taskId, options.fetch)
              .catch(() => {});
            return { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
          }
          if (lease.task.runId) {
            await publishRunProgressSafely(env, message.businessId, lease.task.runId, 'working');
          }
          await pulseTelegramTyping(env, lease.task).catch(() => {});
          return { action: 'requeue', delaySeconds: 5, reason: 'Hermes run is still active' };
        }

        const successful = outcome.remoteStatus === 'completed';
        let telegramDelivery: 'sent' | 'needs_approval' | 'blocked' | undefined;
        if (successful && outcome.payload.telegram && lease.task.runId) {
          const alreadyHandled = await withTenant(env, message.businessId, async (tx) => {
            const [row] = await tx<{ status: string }[]>`
              select status from run where id = ${lease.task.runId}`;
            return row && row.status !== 'working';
          });
          if (!alreadyHandled) {
            const telegram = outcome.payload.telegram;
            telegramDelivery = await deliverTelegramDraft(
              env,
              message.businessId,
              telegram.connectionId,
              lease.task.runId,
              {
                chatId: telegram.chatId,
                messageId: telegram.messageId,
                from: telegram.from,
                text: telegram.question,
              },
              runtimeText(outcome.result),
              outcome.payload.factKeys ?? [],
              'automatic',
            );
          }
          /* The working bubble's job is done: the durable answer is now in
             the chat (or awaits approval / never landed). Delete it so the
             chat does not sit on "⏳ Working…" forever. */
          await liveStream?.cleanup();
        }

        const completed = await withTenant(env, message.businessId, async (tx) => {
          const done = await completeRuntimeTask(
            tx,
            message.businessId,
            message.taskId,
            leaseToken,
            {
              remoteRunId: outcome.remoteRunId,
              remoteStatus: outcome.remoteStatus,
              /* Hermes output is ephemeral here. App answers keep their bounded
                 result; Telegram retains only delivery state because the final
                 customer-visible message is already in the audit record. */
              result: outcome.payload.telegram
                ? { delivery: telegramDelivery ?? 'already_handled' }
                : outcome.result,
              scrubPayload: Boolean(outcome.payload.telegram),
            },
          );
          if (!done) return done;
          const usageStatus = successful
            ? 'completed'
            : outcome.remoteStatus === 'cancelled' || outcome.remoteStatus === 'stopped'
              ? 'cancelled'
              : 'failed';
          await finalizeRuntimeUsage(
            tx,
            message.businessId,
            message.taskId,
            usageStatus,
            outcome.usage,
          );
          if (!lease.task.runId || (successful && outcome.payload.telegram)) return done;
          await recordWork(tx, message.businessId, {
            runId: lease.task.runId,
            objective: outcome.payload.objective ?? outcome.payload.input.slice(0, 1_000),
            outcome: outcome.summary,
            status: successful ? 'completed' : 'failed',
            function: outcome.payload.function ?? 'agent',
            channel: outcome.payload.channel ?? 'runtime',
            risk: 'low',
            inputsUsed: {
              factKeys: outcome.payload.factKeys ?? [],
              grounded: outcome.payload.grounded ?? false,
            },
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
          await stopRuntimeTask(env, message.businessId, message.taskId, options.fetch)
            .catch(() => {});
          return { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
        }
        if (lease.task.runId) {
          const progress = outcome.remoteStatus === 'cancelled' || outcome.remoteStatus === 'stopped'
            ? 'cancelled'
            : outcome.remoteStatus === 'completed' ? 'completed' : 'failed';
          await publishRunProgressSafely(env, message.businessId, lease.task.runId, progress);
        }
        await wakeNextRuntimeTask(env, message.businessId);
        return { action: 'ack', reason: 'completed' };
      }
      default:
        throw new Error(`runtime task ${lease.task.kind} is not implemented`);
    }

    const completed = await withTenant(env, message.businessId, (tx) =>
      completeRuntimeTask(
        tx,
        message.businessId,
        message.taskId,
        leaseToken,
        lifecycleResult ? { result: lifecycleResult } : {},
      ),
    );
    if (!completed) {
      return { action: 'retry', delaySeconds: 10, reason: 'runtime task lease was lost' };
    }
    await wakeNextRuntimeTask(env, message.businessId);
    return { action: 'ack', reason: 'completed' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    /* A runner can remain busy for a moment after the durable lease in the
       control plane is released. Poll it promptly without charging this as a
       failed attempt or imposing the generic 30-second retry penalty. */
    if (error instanceof RuntimeBusyError) {
      const deferred = await withTenant(env, message.businessId, (tx) =>
        deferRuntimeTask(tx, message.businessId, message.taskId, leaseToken, {
          delaySeconds: BUSY_RETRY_SECONDS,
        }));
      return {
        action: 'requeue',
        delaySeconds: BUSY_RETRY_SECONDS,
        reason: deferred ? 'business runtime is busy' : 'runtime task lease was lost',
      };
    }
    const terminal = error instanceof RuntimeBudgetExceeded ||
      lease.task.attempt + 1 >= MAX_TASK_ATTEMPTS;
    if (terminal) {
      let measured: { inputTokens: number; outputTokens: number } | undefined;
      if (lease.task.kind === 'run' && lease.task.remoteRunId) {
        const stopped = await stopRuntimeTask(
          env, message.businessId, message.taskId, options.fetch,
        ).catch(() => null);
        measured = stopped ? measuredUsageOf(stopped) ?? undefined : undefined;
      }
      const exhausted = await withTenant(env, message.businessId, async (tx) => {
        const changed = await exhaustRuntimeTask(
          tx,
          message.businessId,
          message.taskId,
          leaseToken,
          reason,
          Boolean(telegramHint(lease.task.payload)),
        );
        if (!changed) return false;
        if (lease.task.kind === 'run') {
          await finalizeRuntimeUsage(
            tx,
            message.businessId,
            message.taskId,
            'failed',
            measured,
          );
          if (lease.task.runId) {
            await finishRun(tx, message.businessId, lease.task.runId, 'failed', {
              runtimeTaskId: lease.task.id,
              reason: error instanceof RuntimeBudgetExceeded ? error.code : 'attempts_exhausted',
            });
          }
        }
        return true;
      });
      if (!exhausted) {
        return { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
      }
      /* Terminal — tidy the working bubble so the chat never sits on a
         frozen "⏳ Working…" (the old draft lane at least expired). */
      await deleteTelegramLiveBubble(env, message.businessId, lease.task, liveBubbleId)
        .catch(() => {});
      if (lease.task.kind === 'run' && lease.task.runId) {
        await publishRunProgressSafely(env, message.businessId, lease.task.runId, 'failed');
      }
      await wakeNextRuntimeTask(env, message.businessId);
      return { action: 'ack', reason: 'failed' };
    }
    await withTenant(env, message.businessId, (tx) =>
      retryRuntimeTask(tx, message.businessId, message.taskId, leaseToken, reason),
    );
    if (lease.task.kind === 'run' && lease.task.runId) {
      await publishRunProgressSafely(env, message.businessId, lease.task.runId, 'retrying');
    }
    return { action: 'requeue', delaySeconds: 30, reason };
  }
}

async function satisfiedReleaseRepair(
  env: Env,
  businessId: string,
  task: RuntimeTask,
) {
  const payload = task.payload as { reason?: unknown } | null;
  if (payload?.reason !== 'release_drift') return null;
  const release = env.RUNTIME_RELEASE?.trim();
  if (!release) return null;
  const runtime = await withTenant(env, businessId, (tx) => getRuntime(tx, businessId));
  return runtimeReady(runtime) &&
    runtime.desiredRelease === release && runtime.observedRelease === release
    ? runtime
    : null;
}

function runtimeDiagnostic(runtime: { observedRegion: string | null }) {
  return { region: runtime.observedRegion };
}

async function pulseTelegramTyping(env: Env, task: RuntimeTask): Promise<void> {
  const telegram = telegramHint(task.payload);
  if (!telegram) return;
  const token = await withTenant(env, task.businessId, (tx) =>
    useCredential(env, tx, telegram.connectionId));
  await sendTyping(token, telegram.chatId);
}

async function telegramLiveStream(
  env: Env,
  task: RuntimeTask,
): Promise<TelegramLiveStream | null> {
  const telegram = telegramHint(task.payload);
  if (!telegram?.privateChat) return null;
  const token = await withTenant(env, task.businessId, (tx) =>
    useCredential(env, tx, telegram.connectionId));
  return new TelegramLiveStream(token, telegram.chatId, {
    messageId: telegram.liveMessageId,
    onMessageId: (messageId) => persistLiveMessageId(env, task.businessId, task.id, messageId),
  });
}

function telegramHint(value: unknown): {
  connectionId: string;
  chatId: number;
  messageId: number;
  privateChat: boolean;
  liveMessageId?: number;
} | null {
  if (!value || typeof value !== 'object') return null;
  const telegram = (value as Record<string, unknown>).telegram;
  if (!telegram || typeof telegram !== 'object') return null;
  const body = telegram as Record<string, unknown>;
  if (typeof body.connectionId !== 'string' || !uuid(body.connectionId) ||
      typeof body.chatId !== 'number' || !Number.isSafeInteger(body.chatId) ||
      typeof body.messageId !== 'number' || !Number.isSafeInteger(body.messageId) ||
      typeof body.privateChat !== 'boolean') return null;
  return {
    connectionId: body.connectionId,
    chatId: body.chatId,
    messageId: body.messageId,
    privateChat: body.privateChat,
    liveMessageId: typeof body.liveMessageId === 'number' && Number.isSafeInteger(body.liveMessageId)
      ? body.liveMessageId
      : undefined,
  };
}

function runtimeText(result: unknown): string {
  if (typeof result === 'string' && result.trim()) {
    return stripHermesThinking(result).trim().slice(0, 4_000);
  }
  if (result && typeof result === 'object') {
    const body = result as Record<string, unknown>;
    for (const key of ['text', 'output', 'response']) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) {
        return stripHermesThinking(value).trim().slice(0, 4_000);
      }
    }
  }
  throw new Error('Hermes returned no Telegram reply');
}

function stripHermesThinking(text: string): string {
  const names = '(?:reasoning_scratchpad|think|reasoning|thinking|thought)';
  return text
    .replace(new RegExp(`<${names}>[\\s\\S]*?<\\/${names}>\\s*`, 'gi'), '')
    .replace(new RegExp(`(?:^|\\n)[ \\t]*<${names}>[\\s\\S]*$`, 'gi'), '')
    .replace(new RegExp(`<\\/${names}>\\s*`, 'gi'), '')
    /* Live `@step:` narration is progress chrome, never part of the answer. */
    .replace(/^\s*@step:[^\n]*\n?/gm, '');
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

/** Collapses a raw CoT slice into a single readable status line, capped so the
    ephemeral bubble stays tidy. Pure display formatting — the durable answer
    lane never sees this text (the runner keeps it out of `output`). */
function sanitiseThinking(text: string, max = 400): string {
  const flattened = text.replace(/[\r\n\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
  if (!flattened) return '';
  return flattened.length <= max ? flattened : `${flattened.slice(0, max - 1)}…`;
}
