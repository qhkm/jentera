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
  deferRuntimeTaskForFlood,
  enqueueRuntimeTask,
  exhaustRuntimeTask,
  leaseRuntimeTask,
  leaseRuntimeTaskWithBusinessLock,
  markRuntimeTaskFloodOwnerNotified,
  nextWaitingRuntimeTaskId,
  recordRuntimeTaskTerminalOutcome,
  renewRuntimeTaskLease,
  retryRuntimeTask,
  runtimeQueuePosition,
  runtimeTaskByDedupeKey,
  type LeaseResult,
  type RuntimeTask,
  type RuntimeTaskKind,
} from './tasks';
import { append, finishRun, recordWork, startRun } from '../runs';
import { dispatchRuntimeRun, measuredUsageOf, stopRuntimeTask } from './run-task';
import { finalizeRuntimeUsage, RuntimeBudgetExceeded } from './usage';
import { deleteRuntime, reconcileRuntime, upgradeRuntime } from './lifecycle';
import { publishRunProgressSafely } from './progress';
import { STEP_STRIP_RE } from './step-progress';
import { deliverTelegramDraft, deleteTelegramLiveBubble, persistLiveMessageId, settleCancelledDraft } from '../telegram-delivery';
import { telegramInternalChat, useCredential } from '../connections';
import {
  deleteMessage,
  editMessageText,
  hermesToolLine,
  sendHermesMessage,
  sendMessage,
  sendTyping,
  TelegramLiveStream,
} from '../connectors/telegram';
import { runtimeModelKeyNeedsRotation } from './openrouter-keys';
import { RuntimeBusyError } from './runner-client';
import {
  getRuntime,
  getRuntimeTelegramAccess,
  type AgentRuntimeRecord,
} from '../agent-runtime';
import { runtimeReady } from './execution';
import { prepareHermesAgent, retrieveHermesContext } from '../ask';
import { modelForResponseMode, responseModeFor } from './response-mode';
import { sanitizePublicRuntimeText } from './public-output';

const MAX_TASK_ATTEMPTS = 5;
const BUSY_RETRY_SECONDS = 2;
const TELEGRAM_FLOOD_DELAY_CAP_SECONDS = 60 * 60;
const TELEGRAM_FLOOD_OWNER_NOTICE =
  '⏳ Telegram is rate-limiting this chat — your answer will appear as soon as it lifts.';
const QUICK_REPLY_STATUS = '⚡ Preparing a quick reply…';
const DEEP_WORK_STATUS = '🧠 Deep work started…';

/** Friendly one-line statuses for the ephemeral Telegram draft, keyed by the
    run-task provisioning stages. Deep work may show them while the model has
    produced no answer text yet. Quick replies deliberately keep one stable
    status instead, except while a real tool is running. The statuses never
    enter the durable answer lane. */
const STAGE_STATUS: Record<string, string> = {
  database_ready: '✅ System ready — starting…',
  provider_awake: '✅ Runner online — starting agent…',
  runner_ready: '✅ Agent session ready — thinking…',
  hermes_started: '✅ Agent started — thinking…',
  run_recorded: '⏳ Researching…',
};

export interface RuntimeTaskQueueMessage {
  version: 1;
  businessId: string;
  taskId: string;
}

export interface TelegramIntakeQueueMessage {
  version: 2;
  kind: 'telegram_intake';
  businessId: string;
  connectionId: string;
  requestedAtMs: number;
  incoming: {
    chatId: number;
    messageId: number;
    from: string;
    text: string;
    privateChat: true;
  };
}

export type RuntimeQueueMessage = RuntimeTaskQueueMessage | TelegramIntakeQueueMessage;

export type RuntimeMessageResult =
  | { action: 'ack'; reason: 'completed' | 'failed' | 'already_done' | 'missing' }
  | { action: 'requeue'; delaySeconds: number; reason: string }
  | { action: 'retry'; delaySeconds: number; reason: string };

export type RuntimeQueueMessageResult = RuntimeMessageResult & {
  /** Intake is converted to the durable task wake-up after admission. */
  nextMessage?: RuntimeTaskQueueMessage;
};

export async function signalTelegramIntake(
  env: Env,
  businessId: string,
  connectionId: string,
  incoming: TelegramIntakeQueueMessage['incoming'],
  requestedAtMs = Date.now(),
): Promise<void> {
  if (!env.RUNTIME_QUEUE) throw new Error('RUNTIME_QUEUE is not configured');
  await env.RUNTIME_QUEUE.send({
    version: 2,
    kind: 'telegram_intake',
    businessId,
    connectionId,
    requestedAtMs,
    incoming,
  });
}

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

/** Queue-first Telegram admission. The Queue event is already durable, so
 * Postgres context loading and task creation no longer delay the webhook.
 * One transaction deduplicates, gathers context, creates the run/task, loads
 * the credential, and computes FIFO position. The newly admitted task then
 * enters the normal runtime path in this same Queue delivery. */
export async function handleRuntimeQueueMessage(
  env: Env,
  message: RuntimeQueueMessage,
  options: { provider?: RuntimeProvider; fetch?: typeof globalThis.fetch } = {},
): Promise<RuntimeQueueMessageResult> {
  if (message.version === 1) return handleRuntimeMessage(env, message, options);
  if (!validTelegramIntake(message)) return { action: 'ack', reason: 'missing' };
  telegramLatency('queue_received', message.requestedAtMs);

  const dedupeKey = `telegram:${message.connectionId}:${message.incoming.chatId}:` +
    `${message.incoming.messageId}`;
  let speculativeBubble: Promise<{ messageId: number } | null> | undefined;
  let speculativeStatus: string | undefined;
  let speculativeToken: string | undefined;
  let admitted: {
    task: RuntimeTask;
    token: string;
    ahead: number;
    runtime: AgentRuntimeRecord | null;
    preleased?: { lease: LeaseResult; leaseToken: string; leaseMs: number };
  };
  try {
    admitted = await withTenant(env, message.businessId, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))`;
      telegramLatency('admission_dedupe_lock_ready', message.requestedAtMs);
      const existing = await runtimeTaskByDedupeKey(tx, message.businessId, dedupeKey);
      const { runtime, token } = await getRuntimeTelegramAccess(
        env,
        tx,
        message.businessId,
        message.connectionId,
      );
      telegramLatency('admission_access_ready', message.requestedAtMs, {
        duplicate: Boolean(existing),
      });
      if (existing) {
        const ahead = existing.status === 'queued' || existing.status === 'failed'
          ? await runtimeQueuePosition(tx, message.businessId, existing.id)
          : 0;
        return { task: existing, token, ahead, runtime };
      }

      const responseMode = responseModeFor(message.incoming.text);
      const model = modelForResponseMode(env, responseMode);
      /* Start Telegram's placeholder request while the remaining context/run
         queries execute. The transaction never awaits this network call; on
         any admission failure the best-effort cleanup below removes it. */
      speculativeStatus = responseMode === 'deep' ? DEEP_WORK_STATUS : QUICK_REPLY_STATUS;
      speculativeToken = token;
      speculativeBubble = sendMessage(
        token,
        message.incoming.chatId,
        speculativeStatus,
      ).then((live) => {
        telegramLatency('placeholder_accepted', message.requestedAtMs, {
          liveMessageId: live.messageId,
        });
        return live;
      }).catch(() => null);
      const { facts, work } = await retrieveHermesContext(tx, message.incoming.text);
      const prepared = prepareHermesAgent(message.incoming.text, facts, work);
      telegramLatency('admission_context_ready', message.requestedAtMs);
      const run = await startRun(tx, message.businessId, {
        kind: 'ask',
        triggerShape: 'owner.message.telegram',
        triggerRef: {
          chatId: message.incoming.chatId,
          messageId: message.incoming.messageId,
          from: message.incoming.from,
          question: message.incoming.text,
        },
        runtime: 'hermes-sprite',
        model,
      });
      telegramLatency('admission_run_ready', message.requestedAtMs);
      /* From this point through lease, serialize with every ordinary Queue
         lease for the business. Do not await Telegram inside the transaction:
         durable admission must still commit if that network request stalls. */
      await tx`select pg_advisory_xact_lock(hashtextextended(${message.businessId}::text, 0))`;
      const task = await enqueueRuntimeTask(tx, message.businessId, {
        kind: 'run',
        runId: run.id,
        dedupeKey,
        payload: {
          input: boundedTelegramInput(prepared.input, message.incoming.text),
          instructions: prepared.instructions,
          sessionId: run.id,
          objective: `Help ${message.incoming.from} on Telegram`,
          function: 'assistant',
          channel: 'telegram',
          factKeys: prepared.usedKeys,
          grounded: prepared.grounded,
          responseMode,
          model,
          requestedAtMs: message.requestedAtMs,
          telegram: {
            connectionId: message.connectionId,
            chatId: message.incoming.chatId,
            messageId: message.incoming.messageId,
            from: message.incoming.from,
            question: message.incoming.text,
            privateChat: true,
          },
        },
      });
      telegramLatency('admission_task_ready', message.requestedAtMs);
      const leaseToken = crypto.randomUUID();
      const leaseStartedAt = Date.now();
      const lease = await leaseRuntimeTaskWithBusinessLock(
        tx,
        message.businessId,
        task.id,
        leaseToken,
      );
      /* Queue position is presentation-only and almost always zero. Pay for
         its count query only when the authoritative lease says work is busy. */
      const ahead = lease.outcome === 'busy'
        ? await runtimeQueuePosition(tx, message.businessId, task.id)
        : 0;
      telegramLatency('admission_lease_ready', message.requestedAtMs, {
        leaseOutcome: lease.outcome,
      });
      return {
        task,
        token,
        ahead,
        runtime,
        preleased: { lease, leaseToken, leaseMs: Date.now() - leaseStartedAt },
      };
    });
    telegramLatency('admission_committed', message.requestedAtMs);
  } catch (error) {
    const speculative = await speculativeBubble;
    if (speculative) {
      /* The task transaction did not commit, so this message has no durable
         owner and must not linger as a frozen reply. */
      if (speculativeToken) {
        await deleteMessage(speculativeToken, message.incoming.chatId, speculative.messageId)
          .catch(() => {});
      }
    }
    throw error;
  }

  const nextMessage: RuntimeTaskQueueMessage = {
    version: 1,
    businessId: message.businessId,
    taskId: admitted.task.id,
  };
  if (admitted.task.status === 'completed' || admitted.task.status === 'cancelled' ||
      admitted.task.status === 'exhausted') {
    return { action: 'ack', reason: 'already_done' };
  }
  /* Another delivery already owns this exact task. Its Queue message remains
     authoritative; acknowledging this duplicate prevents a second bubble. */
  if (admitted.task.status === 'leased') {
    return { action: 'ack', reason: 'already_done' };
  }

  const existingBubbleId = telegramHint(admitted.task.payload)?.liveMessageId;
  let liveMessageId = existingBubbleId;
  let speculativeBubbleId: number | undefined;
  let createdBubbleId: number | undefined;
  if (!liveMessageId) {
    const mode = runtimeResponseMode(admitted.task.payload);
    const placeholder = admitted.ahead > 0
      ? `⏳ In line (position #${admitted.ahead + 1}) — I'll answer right after the current request.`
      : mode === 'deep'
        ? DEEP_WORK_STATUS
        : QUICK_REPLY_STATUS;
    const live = speculativeBubble
      ? await speculativeBubble
      : await sendMessage(
          admitted.token,
          message.incoming.chatId,
          placeholder,
        ).catch(() => null);
    liveMessageId = live?.messageId;
    createdBubbleId = live?.messageId;
    speculativeBubbleId = speculativeBubble ? live?.messageId : undefined;
    if (live && speculativeStatus && placeholder !== speculativeStatus) {
      await editMessageText(
        admitted.token,
        message.incoming.chatId,
        live.messageId,
        placeholder,
      ).catch(() => {});
    }
  }
  if (admitted.ahead > 0 && speculativeBubbleId && speculativeStatus) {
    const queued = `⏳ In line (position #${admitted.ahead + 1}) — I'll answer right after the current request.`;
    if (queued !== speculativeStatus) {
      await editMessageText(
        admitted.token,
        message.incoming.chatId,
        speculativeBubbleId,
        queued,
      ).catch(() => {});
    }
  }

  const leaseToken = admitted.preleased?.leaseToken ?? crypto.randomUUID();
  const leaseStartedAt = Date.now();
  let lease = admitted.preleased?.lease;
  let bubblePersistence: Promise<boolean> | undefined;
  try {
    if (!lease) {
      lease = await withTenant(env, message.businessId, async (tx) => {
        if (liveMessageId && !existingBubbleId) {
          await tx`update runtime_task
             set payload = payload || jsonb_build_object('telegram',
               coalesce(payload->'telegram', '{}'::jsonb) ||
               jsonb_build_object('liveMessageId', ${liveMessageId}::int))
           where id = ${admitted.task.id}`;
        }
        return leaseRuntimeTask(
          tx,
          message.businessId,
          admitted.task.id,
          leaseToken,
        );
      });
    } else if (liveMessageId && !existingBubbleId) {
      /* Admission deliberately committed the lease without awaiting
         Telegram. Begin the now-resolved bubble write without holding model
         dispatch behind another inter-region round trip. The result is still
         joined below before this Queue delivery can finish. */
      bubblePersistence = persistLiveMessageId(
        env,
        message.businessId,
        admitted.task.id,
        liveMessageId,
      ).then(() => {
        telegramLatency('admission_bubble_persisted', message.requestedAtMs, {
          persisted: true,
        });
        return true;
      }, (error) => {
        console.error(`[telegram] live bubble persist failed: ${String(error)}`);
        telegramLatency('admission_bubble_persisted', message.requestedAtMs, {
          persisted: false,
        });
        return false;
      });
    }
    telegramLatency('dispatch_unblocked', message.requestedAtMs, {
      liveMessage: Boolean(liveMessageId),
    });
  } catch (error) {
    if (admitted.preleased) {
      /* Admission already committed the lease. If the rare follow-up bubble
         persist fails, release it before Queue retries; otherwise the intake
         retry would see an ownerless leased task and acknowledge it forever. */
      await withTenant(env, message.businessId, (tx) => deferRuntimeTask(
        tx,
        message.businessId,
        admitted.task.id,
        leaseToken,
        { delaySeconds: 0 },
      )).catch(() => {});
    }
    /* A bubble sent just before a failed persist would otherwise become an
       orphan while Telegram retries the durable Queue event. */
    if (createdBubbleId) {
      await deleteMessage(admitted.token, message.incoming.chatId, createdBubbleId)
        .catch(() => {});
    }
    throw error;
  }

  const result = await handleRuntimeMessage(env, nextMessage, {
    ...options,
    preleased: {
      lease,
      leaseToken,
      leaseMs: admitted.preleased?.leaseMs ?? Date.now() - leaseStartedAt,
    },
    telegramToken: admitted.token,
    liveMessageId,
    runtimeSnapshot: { value: admitted.runtime },
  });
  const bubblePersisted = await bubblePersistence;
  if (bubblePersistence && !bubblePersisted && result.action !== 'ack' && createdBubbleId) {
    /* A later Queue slice cannot reattach a bubble whose id was not durable.
       Remove it now; the durable task still requeues and its final answer will
       use a fresh message instead of leaving this one frozen in the chat. */
    await deleteMessage(admitted.token, message.incoming.chatId, createdBubbleId)
      .catch(() => {});
  }
  return result.action === 'ack' ? result : { ...result, nextMessage };
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
  message: RuntimeTaskQueueMessage,
  options: {
    provider?: RuntimeProvider;
    fetch?: typeof globalThis.fetch;
    preleased?: { lease: LeaseResult; leaseToken: string; leaseMs: number };
    telegramToken?: string;
    liveMessageId?: number;
    runtimeSnapshot?: { value: AgentRuntimeRecord | null };
  } = {},
): Promise<RuntimeMessageResult> {
  const messageStartedAt = Date.now();
  /* The live Telegram bubble from this delivery slice, hoisted so the
     terminal-failure path can tidy it even if the persisted payload was
     scrubbed by exhaustion. */
  let liveBubbleId: number | undefined = options.liveMessageId;
  if (message.version !== 1 || !uuid(message.businessId) || !uuid(message.taskId)) {
    return { action: 'ack', reason: 'missing' };
  }

  const leaseToken = options.preleased?.leaseToken ?? crypto.randomUUID();
  const leaseStartedAt = Date.now();
  const lease = options.preleased?.lease ?? await withTenant(env, message.businessId, (tx) =>
    leaseRuntimeTask(tx, message.businessId, message.taskId, leaseToken),
  );
  const leaseMs = options.preleased?.leaseMs ?? Date.now() - leaseStartedAt;

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
    void publishRunProgressSafely(
      env,
      message.businessId,
      lease.task.runId,
      lease.task.remoteRunId ? 'working' : 'waking',
    );
  }

  try {
    let lifecycleResult: { region: string | null } | undefined;
    /* Queue-first admission also accepts work while a runtime is being
       provisioned or repaired. Preserve the request, release its business
       slot, and let an immediate lifecycle task win before the delayed run
       wakes again. Release drift follows the same path. */
    if (lease.task.kind === 'run') {
      const runtime = options.runtimeSnapshot
        ? options.runtimeSnapshot.value
        : await withTenant(env, message.businessId, (tx) =>
            getRuntime(tx, message.businessId));
      const release = env.RUNTIME_RELEASE?.trim();
      const releaseDrift = Boolean(runtime && release &&
        (runtime.desiredRelease !== release || runtime.observedRelease !== release));
      if (!runtimeReady(runtime) || releaseDrift) {
        const kind: RuntimeTaskKind = !runtime
          ? 'provision'
          : releaseDrift
            ? 'upgrade'
            : 'reconcile';
        const reason = !runtime
          ? 'runtime_missing'
          : releaseDrift
            ? 'release_drift'
            : 'runtime_not_ready';
        const deferred = await withTenant(env, message.businessId, (tx) =>
          deferRuntimeTask(tx, message.businessId, message.taskId, leaseToken, {
            delaySeconds: 30,
          }));
        if (!deferred) {
          return { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
        }
        const repairWindow = Math.floor(Date.now() / (5 * 60 * 1_000));
        await publishRuntimeTask(env, message.businessId, {
          kind,
          dedupeKey: `${kind}:${message.businessId}:${release ?? 'unset'}:${repairWindow}`,
          payload: { release, reason },
        });
        return {
          action: 'requeue',
          delaySeconds: 30,
          reason: releaseDrift ? 'runtime release upgrade' : 'runtime preparation',
        };
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
          const requestedAtMs = runtimeRequestedAt(lease.task.payload);
          console.info('[runtime-latency]', JSON.stringify({
            stage,
            queueElapsedMs: Date.now() - messageStartedAt,
            ...(requestedAtMs === undefined
              ? {}
              : { requestElapsedMs: Date.now() - requestedAtMs }),
            ...(dispatchElapsedMs === undefined ? {} : { dispatchElapsedMs }),
            ...extra,
            channel: telegramHint(lease.task.payload) ? 'telegram' : 'app',
          }));
        };
        latency('leased', undefined, { leaseMs });
        const liveStream = await telegramLiveStream(
          env,
          lease.task,
          options.telegramToken,
          options.liveMessageId,
        );
        liveBubbleId = liveStream?.id;
        /* Diagnostics for the "frozen bubble" bug class: whether the live
           lane was reattached at lease time (stream open) or silently absent
           (null hint / credential failure), plus which bubble id it was
           supposed to animate. The durable answer is unaffected either way. */
        {
          const hint = telegramHint(lease.task.payload);
          latency('live_reattach', undefined, {
            liveStream: liveStream ? 'open' : 'null',
            liveMessageId: hint?.liveMessageId ?? null,
            chatId: hint?.chatId ?? null,
            privateChat: hint?.privateChat ?? null,
            bubbleId: liveStream?.id ?? null,
          });
        }
        const toolShown = new Set<string>();
        /* Typing is cosmetic and the webhook already emitted an immediate
           pulse. Refresh it in parallel so Telegram cannot hold model start
           behind another network round trip. */
        void liveStream?.pulseTyping(true);
        let lastLeaseRenewal = Date.now();
        let firstVisibleDelta = false;
        let statusTimer: ReturnType<typeof setInterval> | undefined;
        /* Last live `@step:` narration (or tool line) shown in the working
           bubble. Rendered with the elapsed ticker until the answer starts. */
        let currentStep = '';
        let currentStepIsTool = false;
        const workingSince = Date.now();
        const responseMode = runtimeResponseMode(lease.task.payload);
        const quickReply = responseMode === 'quick';
        if (liveStream) {
          void liveStream.setStatus(quickReply ? QUICK_REPLY_STATUS : DEEP_WORK_STATUS);
          statusTimer = setInterval(() => {
            if (firstVisibleDelta) return;
            /* A quick reply should feel like one short wait, not a miniature
               deep-research workflow. Only a real tool may replace its label. */
            if (quickReply && !currentStepIsTool) return;
            const elapsed = Math.round((Date.now() - workingSince) / 1_000);
            void liveStream.setStatus(currentStep
              ? `${statusLine(currentStep)} · ${elapsed}s`
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
                  if (quickReply && !firstVisibleDelta) {
                    await liveStream.setStatus(QUICK_REPLY_STATUS);
                  }
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
                if (quickReply) return;
                currentStep = statusLine(label);
                currentStepIsTool = false;
                if (!firstVisibleDelta) {
                  const elapsed = Math.round((Date.now() - workingSince) / 1_000);
                  await liveStream.setStatus(`${currentStep} · ${elapsed}s`);
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
                if (quickReply || firstVisibleDelta) return;
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
            if (quickReply) return;
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
        const terminal = await withTenant(env, message.businessId, async (tx) => {
          const saved = await recordRuntimeTaskTerminalOutcome(
            tx,
            message.businessId,
            message.taskId,
            leaseToken,
            outcome.remoteRunId,
            {
              remoteStatus: outcome.remoteStatus,
              result: outcome.result,
              reasoning: outcome.reasoning,
              summary: outcome.summary,
              usage: outcome.usage,
            },
          );
          if (!saved) return { saved: false, deliveryClaimed: false };
          if (!successful || !outcome.payload.telegram || !lease.task.runId) {
            return { saved: true, deliveryClaimed: false };
          }
          /* The flood-replay snapshot must commit before Telegram delivery.
             Reuse that same transaction for the run-state guard and proposal
             audit instead of adding a separate cross-region transaction in
             front of the user-visible final edit. */
          const [run] = await tx<{ status: string }[]>`
            select status from run where id = ${lease.task.runId}`;
          if (!run || run.status !== 'working') {
            return { saved: true, deliveryClaimed: false };
          }
          await append(tx, message.businessId, lease.task.runId, 'action.proposed', {
            connector: 'telegram',
            op: 'send_message',
            chatId: outcome.payload.telegram.chatId,
          });
          return { saved: true, deliveryClaimed: true };
        });
        if (!terminal.saved) {
          return { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
        }

        let telegramDelivery: 'sent' | 'needs_approval' | 'blocked' | 'already_handled' | undefined;
        let finalizedLiveBubble = false;
        if (successful && outcome.payload.telegram && lease.task.runId) {
          const telegram = outcome.payload.telegram;
          const reusableMessageId = telegram.privateChat
            ? liveStream?.handoffMessageId() ?? liveBubbleId
            : undefined;
          if (terminal.deliveryClaimed) {
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
              finalDurableText(
                outcome.result,
                outcome.payload.responseMode === 'quick' ? undefined : outcome.reasoning,
              ),
              outcome.payload.factKeys ?? [],
              'automatic',
              options.telegramToken,
              reusableMessageId,
              { proposalRecorded: true },
            );
            if (telegramDelivery === 'sent') latency('telegram_final_accepted');
            finalizedLiveBubble = telegramDelivery === 'sent' && Boolean(reusableMessageId);
          }
          /* A reused bubble is now the durable answer and must stay. When no
             bubble could be reused (or another delivery already won), tidy
             up any remaining working message so it cannot freeze in chat. */
          if (!finalizedLiveBubble) await liveStream?.cleanup();
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
    /* Telegram throttles chat traffic with a flood-wait ("Too Many Requests:
       retry after N"). Re-hammering near the edge of that window can escalate
       the next wait, so use a wider bounded margin. This is delivery
       backpressure, not a failed model run: requeue without consuming the
       attempt budget (deferRuntimeTaskForFlood, not retryRuntimeTask). */
    const floodSeconds = /retry after (\d+)/i.exec(reason)?.[1];
    if (floodSeconds) {
      const reportedWaitSeconds = Number(floodSeconds);
      const delaySeconds = telegramFloodDelaySeconds(reportedWaitSeconds);
      const deferred = await withTenant(env, message.businessId, (tx) =>
        deferRuntimeTaskForFlood(tx, message.businessId, message.taskId, leaseToken, {
          floodWaitSeconds: reportedWaitSeconds,
          delaySeconds,
        }));
      if (!deferred.deferred) {
        return { action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost' };
      }
      if (lease.task.kind === 'run' && lease.task.runId) {
        await publishRunProgressSafely(env, message.businessId, lease.task.runId, 'retrying');
      }
      if (deferred.shouldNotifyOwner) {
        await notifyTelegramFloodOwner(
          env,
          message.businessId,
          lease.task,
          options.telegramToken,
        );
      }
      return { action: 'requeue', delaySeconds, reason: `telegram flood-wait ${floodSeconds}s` };
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

/** Telegram's first retry-after is often optimistic. Use the agreed wider
    margin, bounded to one hour (well inside Queue's 24-hour message-delay
    limit); Postgres available_at remains the authoritative lease gate. */
export function telegramFloodDelaySeconds(reportedWaitSeconds: number): number {
  const wait = Number.isSafeInteger(reportedWaitSeconds) && reportedWaitSeconds > 0
    ? reportedWaitSeconds
    : 1;
  return Math.min(
    TELEGRAM_FLOOD_DELAY_CAP_SECONDS,
    Math.max(60, wait * 2, wait + 60),
  );
}

async function notifyTelegramFloodOwner(
  env: Env,
  businessId: string,
  task: RuntimeTask,
  existingToken?: string,
): Promise<void> {
  const telegram = telegramHint(task.payload);
  if (!telegram) return;
  try {
    const destination = await withTenant(env, businessId, async (tx) => ({
      chatId: await telegramInternalChat(tx, telegram.connectionId),
      token: existingToken ?? await useCredential(env, tx, telegram.connectionId),
    }));
    if (!destination.chatId) return;
    await sendHermesMessage(
      destination.token,
      destination.chatId,
      TELEGRAM_FLOOD_OWNER_NOTICE,
    );
    await withTenant(env, businessId, (tx) =>
      markRuntimeTaskFloodOwnerNotified(tx, businessId, task.id));
  } catch (error) {
    /* The notice can be rate-limited by the same Telegram flood. Keep the
       notified flag false so a later escalation may try once more. */
    console.warn('[runtime] Telegram flood notice was not delivered', {
      businessId,
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
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
  existingToken?: string,
  initialMessageId?: number,
): Promise<TelegramLiveStream | null> {
  const telegram = telegramHint(task.payload);
  if (!telegram?.privateChat) return null;
  const token = existingToken ?? await withTenant(env, task.businessId, (tx) =>
    useCredential(env, tx, telegram.connectionId));
  return new TelegramLiveStream(token, telegram.chatId, {
    messageId: initialMessageId ?? telegram.liveMessageId,
    onMessageId: (messageId) => persistLiveMessageId(env, task.businessId, task.id, messageId),
    onFirstTextPublished: () => telegramLatency(
      'first_telegram_edit_accepted',
      runtimeRequestedAt(task.payload),
      { liveMessageId: initialMessageId ?? telegram.liveMessageId ?? null },
    ),
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

function runtimeResponseMode(payload: unknown): 'quick' | 'deep' {
  if (!payload || typeof payload !== 'object') return 'deep';
  return (payload as Record<string, unknown>).responseMode === 'quick' ? 'quick' : 'deep';
}

function runtimeRequestedAt(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>).requestedAtMs;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const now = Date.now();
  return value <= now + 60_000 && value >= now - 24 * 60 * 60 * 1_000
    ? value
    : undefined;
}

function telegramLatency(
  stage: string,
  requestedAtMs: number | undefined,
  extra: Record<string, unknown> = {},
): void {
  console.info('[runtime-latency]', JSON.stringify({
    stage,
    ...(requestedAtMs === undefined ? {} : { requestElapsedMs: Date.now() - requestedAtMs }),
    ...extra,
    channel: 'telegram',
  }));
}

function validTelegramIntake(
  message: TelegramIntakeQueueMessage,
): message is TelegramIntakeQueueMessage {
  const incoming = message.incoming;
  return message.kind === 'telegram_intake' &&
    uuid(message.businessId) && uuid(message.connectionId) &&
    typeof message.requestedAtMs === 'number' && Number.isFinite(message.requestedAtMs) &&
    message.requestedAtMs > 0 &&
    Boolean(incoming) && Number.isSafeInteger(incoming.chatId) &&
    Number.isSafeInteger(incoming.messageId) &&
    typeof incoming.from === 'string' && incoming.from.length > 0 && incoming.from.length <= 256 &&
    typeof incoming.text === 'string' && incoming.text.trim().length > 0 &&
    incoming.text.length <= 4_000 && incoming.privateChat === true;
}

function boundedTelegramInput(input: string, question: string): string {
  const max = 19_500;
  if (input.length <= max) return input;
  const suffix = `\n\nUser request: ${question}`;
  return `${input.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

/** Durable final message: Hermes's `💭 **Reasoning:**` block (mirrored from
    gateway/run.py — collapsed to 15 lines) followed by the answer. The answer
    gets priority inside Telegram's 4k cap; reasoning shrinks or disappears
    before user-visible answer text is truncated. */
export function finalDurableText(result: unknown, reasoning: unknown): string {
  const answer = runtimeText(result);
  const block = reasoningBlock(reasoning, 4_000 - answer.length);
  return sanitizePublicRuntimeText(`${block}${answer}`);
}

function reasoningBlock(reasoning: unknown, maxLength = 4_000): string {
  if (typeof reasoning !== 'string' || !reasoning.trim()) return '';
  const prefix = '💭 **Reasoning:**\n```\n';
  const suffix = '\n```\n\n';
  const available = maxLength - prefix.length - suffix.length;
  if (available < 16) return '';
  let body = collapseReasoning(reasoning.trim(), 15);
  if (body.length > available) {
    body = `${body.slice(0, Math.max(0, available - 1)).trimEnd()}…`;
  }
  return `${prefix}${body}${suffix}`;
}

function collapseReasoning(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  const dropped = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join('\n')}\n_... (${dropped} more lines)_`;
}

export function stripHermesThinking(text: string): string {
  /* MiniMax may namespace its reasoning marker as `<mm:think>`. The provider
     sometimes removes only the opening marker, so the optional namespace must
     apply to the orphan-close backstop as well as complete blocks. */
  const names = '(?:(?:[a-z][\\w.-]*:)?(?:reasoning_scratchpad|think|reasoning|thinking|thought))';
  /* Soft box-drawing pipes first, so one marker vocabulary (ASCII pipe)
     covers both the prompt convention and whatever the model actually
     emitted. Framed blocks │ thinking│ … │/thinking│ are removed whole;
     an unclosed block runs to the end of the answer; stray close-frames
     and Hermes's bare  thinking …  response scratchpad lines are dropped
     the same way the streaming scrubber handles them. This is the durable
     backstop — the runner already keeps these lanes apart live. */
  let out = text.replace(/[│┃┆┊]/g, '|');
  out = out
    .replace(/\s*\|[ \t]*thinking\|[^]*?\|[ \t]*\/thinking\|?[ \t]*/gi, '')
    .replace(/\s*\|[ \t]*thinking\|[^]*$/gi, '')
    .replace(/\|[ \t]*\/thinking\|?[ \t]*/gi, '')
    .replace(/(?:^|\n)[ \t]* thinking[ \t]*\n[^]*?(?=\n[ \t]* response[ \t]*(?:\n|$)|$)/gi, '\n')
    .replace(/\n[ \t]* response[ \t]*(?:\n|$)/gi, '\n')
    .replace(new RegExp(`<${names}>[\\s\\S]*?<\\/${names}>\\s*`, 'gi'), '')
    .replace(new RegExp(`(?:^|\\n)[ \\t]*<${names}>[\\s\\S]*$`, 'gi'), '')
    .replace(new RegExp(`<\\/${names}>\\s*`, 'gi'), '')
    /* Live `@step:` narration is progress chrome, never part of the answer.
       Tolerant whole-line strip (markdown/bullet variants)… */
    .replace(STEP_STRIP_RE, '')
    /* …plus any marker remnant that slipped past line detection. */
    .replace(/@step:[^\n]*/gi, '');
  return out;
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

/** Renders one working-bubble status line from a progress label: whitespace
    collapsed, stray markdown noise removed, never multi-line. The bubble edit
    is plain text — every status update replaces the previous line, so stacked
    paragraphs can only come from label garbage sneaking in here. */
function statusLine(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[*_`~]+/g, '')
    .trim()
    .slice(0, 120);
}
