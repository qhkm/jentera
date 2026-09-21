import type { Env } from '../env';
import {
  getRuntime,
  getRuntimeAccess,
  getRuntimeSecrets,
  recordObservedConfigVersion,
} from '../agent-runtime';
import { withTenant } from '../db';
import type { RuntimeProvider } from './provider';
import { runtimeProviderFor } from './provision';
import {
  RunnerClient,
  RUNNER_INPUT_MAX,
  RUNNER_INSTRUCTIONS_MAX,
  type RunnerApprovalRequest,
  type RunnerTaskResponse,
  type RunnerToolEvent,
} from './runner-client';
import { recordRuntimeTaskRemoteRun, type RuntimeTask } from './tasks';
import { issueFullToolsGrant } from './tool-grant';
import { markRuntimeUsageStarted, reserveRuntimeUsage } from './usage';
import { runtimeTaskIsCancelled } from './tasks';
import { append } from '../runs';
import type { ResponseMode } from './response-mode';
import { modelForResponseMode } from './response-mode';
import { specialistProfileValid, type SpecialistProfile } from '../specialists';
import { isDirectDeepSeek } from '../model-upstream';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stopped', 'expired']);

/** A successful HTTP stop request is not confirmation that execution ended. */
export function confirmedStop(response: RunnerTaskResponse | null): RunnerTaskResponse {
  if (!response || !TERMINAL.has(boundedStatus(response.status))) {
    throw new Error('Could not confirm that the task stopped; it may still be running');
  }
  return response;
}

export function stoppedRunOutcome(response: RunnerTaskResponse | null, remoteRunId: string, payload: RunPayload): RuntimeRunOutcome {
  const stopped = confirmedStop(response);
  return { state: 'terminal', remoteRunId, remoteStatus: boundedStatus(stopped.status),
    result: boundedResult(stopped), summary: summaryOf(stopped), payload,
    usage: measuredUsageOf(stopped) ?? undefined };
}

/** Every dispatch holds the Sprite active this long past the dispatch.
    Each dispatch refreshes the window, so a messaging business stays
    always-on and a silent one releases itself (stops billing) after the
    grace window. Launch posture was 24 hours on every plan; production
    sets AISAR_KEEPALIVE_GRACE_HOURS=0 since 2026-09-09, which sends no
    hold at all: an idle sprite pauses and the first message after a pause
    pays the wake. Unset or unparseable still means 24. */
const KEEPALIVE_GRACE_HOURS_DEFAULT = 24;

/** A quick reply is one chat turn. The business budget allows a run up to
    max_run_seconds (900 by default) and deep work keeps that; a chat turn
    still running after five minutes is stuck, and five minutes is what it
    should cost. The runner enforces the deadline it is handed, so this
    holds even when the worker loses track of the task. On 2026-09-03 a
    two-word follow-up ran for 7 h 15 min before any limit applied. */
export const QUICK_RUN_CAP_SECONDS = 300;

/* How stale an unstarted request may be before answering it is pointless.
   Ten minutes is far past any honest wake — a cold sprite bootstraps in about
   200 seconds — and well short of the point where a reply would surprise
   whoever asked. */
export const INTAKE_TTL_MS = 10 * 60 * 1_000;

function runSecondsFor(mode: ResponseMode | undefined, budgetSeconds: number): number {
  return mode === 'quick' ? Math.min(budgetSeconds, QUICK_RUN_CAP_SECONDS) : budgetSeconds;
}

function keepaliveGraceHours(env: Env): number {
  const raw = env.AISAR_KEEPALIVE_GRACE_HOURS?.trim();
  if (!raw) return KEEPALIVE_GRACE_HOURS_DEFAULT;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : KEEPALIVE_GRACE_HOURS_DEFAULT;
}

export interface RunPayload {
  input: string;
  instructions?: string;
  profile?: SpecialistProfile;
  sessionId?: string;
  objective?: string;
  function?: string;
  channel?: string;
  factKeys?: string[];
  grounded?: boolean;
  responseMode?: ResponseMode;
  selectedSkills?: string[];
  model?: string;
  requestedAtMs?: number;
  telegram?: {
    connectionId: string;
    chatId: number;
    messageId: number;
    from: string;
    question: string;
    privateChat: boolean;
    liveMessageId?: number;
  };
}

export type RuntimeRunOutcome =
  | { state: 'pending'; remoteRunId: string; remoteStatus: string }
  | {
      state: 'approval';
      remoteRunId: string;
      remoteStatus: 'waiting_for_approval';
      approval: RunnerApprovalRequest;
      payload: RunPayload;
    }
  | {
      state: 'terminal';
      remoteRunId: string;
      remoteStatus: string;
      result: unknown;
      /** Hermes's `last_reasoning` on the terminal run status (bounded by the
          runner; consumed by the durable `💭 **Reasoning:**` block). */
      reasoning?: unknown;
      summary: string;
      payload: RunPayload;
      usage?: { inputTokens: number; outputTokens: number };
    };

export async function dispatchRuntimeRun(
  env: Env,
  task: RuntimeTask,
  leaseToken: string,
  options: {
    provider?: RuntimeProvider;
    fetch?: typeof globalThis.fetch;
    onDelta?: (delta: string) => Promise<void>;
    onToolEvent?: (event: RunnerToolEvent) => Promise<void>;
    /** The real Hermes model-call iteration and configured ceiling. */
    onIteration?: (current: number, total: number) => Promise<void>;
    onHeartbeat?: () => Promise<void>;
    /** A complete `@step:` progress label the model emitted. */
    onProgress?: (label: string) => Promise<void>;
    /** A bounded slice of the model's live reasoning (runner-redacted). */
    onThinking?: (text: string) => Promise<void>;
    onStage?: (stage: string, elapsedMs: number) => void;
    /** Skip the runner's history replay up to and including this seq. */
    afterSeq?: number;
    /** The runner seq of each relayed event, for the slice to persist. */
    onStreamSeq?: (seq: number) => void;
  } = {},
): Promise<RuntimeRunOutcome> {
  const dispatchStartedAt = Date.now();
  const stage = (name: string) => options.onStage?.(name, Date.now() - dispatchStartedAt);
  const payload = runPayload(task.payload);
  // Delivery can retry after the computer disappears. Durable terminal truth
  // must not require readiness or restart the original work.
  const persisted = persistedTerminalOutcome(task, payload);
  if (persisted) return persisted;
  if (task.remoteRunId && task.remoteStatus === 'expired') {
    return { state: 'terminal', remoteRunId: task.remoteRunId, remoteStatus: 'expired',
      result: { error: 'run deadline exceeded' }, summary: 'Run deadline exceeded.', payload };
  }
  const model = payload.model ??
    modelForResponseMode(env, payload.responseMode ?? 'deep', task.businessId);
  const { runtime, secrets, reservation, keepaliveUntil } = await withTenant(
    env,
    task.businessId,
    async (tx) => {
      const { runtime, secrets } = await getRuntimeAccess(env, tx, task.businessId);
      const reservation = await reserveRuntimeUsage(
        tx,
        task.businessId,
        task.id,
        model,
      );
      const graceHours = keepaliveGraceHours(env);
      const keepaliveUntil = graceHours > 0
        ? new Date(Date.now() + graceHours * 3_600_000).toISOString()
        : null;
      return { runtime, secrets, reservation, keepaliveUntil };
    },
  );
  stage('database_ready');
  if (!runtime?.providerId || !runtime.providerUrl) throw new Error('runtime is not provisioned');
  if (!['ready', 'cold', 'idle', 'busy'].includes(runtime.status)) {
    throw new Error(`runtime is not dispatchable (${runtime.status})`);
  }

  const provider = options.provider ?? runtimeProviderFor(env);
  if (runtime.provider !== provider.id) {
    throw new Error(`runtime provider mismatch (${runtime.provider})`);
  }
  const target = {
    provider: runtime.provider,
    id: runtime.providerId,
    name: runtime.providerName,
    url: runtime.providerUrl,
    state: runtime.status,
  };
  /* The authenticated /readyz request itself wakes a Sprite and also attests
     Hermes, the release, and the loaded source. A preceding /healthz call was
     a second serial edge round trip with no additional decision value. Keep
     provider.wake for non-Sprite adapters whose lifecycle may require it. */
  const observed = runtime.provider === 'fly-sprite'
    ? target
    : await provider.wake(target);
  if (runtime.provider !== 'fly-sprite') stage('provider_awake');
  const client = new RunnerClient({
    origin: observed.url,
    runnerKey: secrets.runnerKey,
    edgeToken: runtime.provider === 'fly-sprite' ? env.SPRITES_TOKEN : undefined,
    expectedRelease: runtime.desiredRelease,
    fetch: options.fetch,
  });
  /* How long readiness took is reported by the intake refusal below, which is
     the one place it explains something: a request that went stale waiting. */
  const readyStartedAt = Date.now();
  const readiness = await client.ready();
  const readyMs = Date.now() - readyStartedAt;
  if (payload.profile && !readiness.specialistProfiles.includes(payload.profile)) {
    throw new Error('business specialist profile has not reached the runtime yet');
  }
  /* Convergence, observed rather than pushed. Best effort: a diagnostic must
     not be able to cost the run it is describing. */
  if (readiness.config) {
    await withTenant(env, task.businessId, (tx) =>
      recordObservedConfigVersion(tx, task.businessId, readiness.config!.version))
      .catch(() => undefined);
  }
  stage('runner_ready');
  const runSeconds = runSecondsFor(payload.responseMode, reservation.maxRunSeconds);
  const elapsedMs = Date.now() - reservation.startedAt.getTime();

  /* A run that Hermes accepted is on its own clock: reservation.startedAt was
     reset to the accept (markRuntimeUsageStarted), so this really is the run
     overrunning its budget and the right answer is to stop it. */
  if (task.remoteRunId && elapsedMs > runSeconds * 1_000) {
    return stoppedRunOutcome(await client.stop(task.id), task.remoteRunId, payload);
  }

  /* A run that has NOT started is a different question, and conflating the two
     is what turned a slow first attempt into a permanent outage on 14-15
     September. The guard here used to compare wall time since intake against
     the run budget, so once attempt 1 was slow — a cold sprite, a refused
     admission — every later attempt failed this line in milliseconds without
     ever calling the runner, and the task exhausted having never tried.
     Retries were dead on arrival by construction.

     What waiting should bound is how stale a request may be before answering
     it is pointless, not how long the answer may take. Past the TTL we stop
     and say so; inside it, each attempt gets a full budget of its own. */
  if (!task.remoteRunId && elapsedMs > INTAKE_TTL_MS) {
    console.warn('[runtime-dispatch]', JSON.stringify({
      stage: 'intake_ttl_expired', task: task.id, attempt: task.attempt,
      elapsedMs, runSeconds, readyMs, responseMode: payload.responseMode ?? 'default',
    }));
    throw new Error('this request waited too long to start and was not sent');
  }
  const toolGrant = await issueFullToolsGrant(
    secrets.runnerKey,
    task.businessId,
    task.id,
  );
  const started = await client.start({
    businessId: task.businessId,
    taskId: task.id,
    leaseToken,
    input: payload.input,
    sessionId: payload.sessionId,
    instructions: payload.instructions,
    profile: payload.profile,
    responseMode: payload.responseMode,
    selectedSkills: payload.selectedSkills,
    // Existing runners admit only their bootstrapped model names. Let their
    // Quick/Deep default select that route; the proxy maps its legacy DeepSeek
    // alias to the canonical model. New runners already default to canonical.
    // Keep the canonical `model` above for reservation/accounting.
    model: isDirectDeepSeek(env) && model === 'deepseek-flash' ? undefined : model,
    toolGrant,
    /* Per attempt, from now. It used to be reservation.startedAt + runSeconds
       — one absolute deadline a retry inherited along with whatever the first
       attempt had already spent, so the 17:08 MYT run on 15 September was
       handed 23 seconds of a 300-second budget and survived only by answering
       in five. The runner ignores this on a duplicate, so a genuine resume
       keeps its original deadline. */
    deadlineAt: Date.now() + runSeconds * 1_000,
    ...(keepaliveUntil ? { keepaliveUntil } : {}),
  });
  stage('hermes_started');
  const remoteRunId = started.hermesRunId;
  if (!remoteRunId) throw new Error('runner returned no Hermes run id');
  const firstStart = !task.remoteRunId;
  const recorded = await withTenant(env, task.businessId, async (tx) => {
    const saved = await recordRuntimeTaskRemoteRun(
      tx,
      task.businessId,
      task.id,
      leaseToken,
      remoteRunId,
      boundedStatus(started.status),
    );
    if (saved && firstStart) {
      await markRuntimeUsageStarted(tx, task.businessId, task.id);
    }
    if (saved && !task.startedAt && task.runId) {
      await append(tx, task.businessId, task.runId, 'work.started', {
        runtimeTaskId: task.id,
        remoteRunId,
      });
    }
    return saved;
  });
  if (!recorded) {
    await client.stop(task.id).catch(() => {});
    throw new Error('runtime task lease was lost after Hermes start');
  }
  stage('run_recorded');
  task.remoteRunId = remoteRunId;

  /* Open the presentation stream while the rare cancellation race is checked.
     The check remains authoritative, but its cross-region transaction no
     longer sits in front of the first visible model token. Capture rejection
     immediately so an early stream failure cannot become unhandled. */
  const streamResult = options.onDelta
    ? client.stream(task.id, {
        onDelta: options.onDelta,
        onToolEvent: options.onToolEvent,
        onIteration: options.onIteration,
        onHeartbeat: options.onHeartbeat,
        onProgress: options.onProgress,
        onThinking: options.onThinking,
        onSeq: options.onStreamSeq,
      }, { afterSeq: options.afterSeq }).then(
        (approval) => ({ ok: true as const, approval }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    : null;
  const cancelled = await withTenant(env, task.businessId, (tx) =>
    runtimeTaskIsCancelled(tx, task.businessId, task.id));
  if (cancelled) {
    // The stream promise already handles rejection; do not wait indefinitely
    // for its EOF after a confirmed stop (or a failed stop attempt).
    return stoppedRunOutcome(await client.stop(task.id), remoteRunId, payload);
  }

  let streamError: unknown;
  if (streamResult) {
    const streamed = await streamResult;
    if (!streamed.ok) streamError = streamed.error;
    stage('stream_finished');
    if (streamed.ok && streamed.approval) {
      return {
        state: 'approval',
        remoteRunId,
        remoteStatus: 'waiting_for_approval',
        approval: streamed.approval,
        payload,
      };
    }
  }

  let current: RunnerTaskResponse;
  try {
    current = await client.status(task.id);
  } catch (error) {
    /* A previous Queue slice may have observed and persisted completion, then
       lost the Telegram delivery race. If the runner later restarts or Hermes
       reaps that run record, the database snapshot is the terminal truth. */
    const restored = persistedTerminalOutcome(task, payload);
    if (!restored) throw error;
    stage('status_restored');
    return restored;
  }
  stage('status_loaded');
  const remoteStatus = boundedStatus(current.status);
  if (!TERMINAL.has(remoteStatus)) {
    // A lost presentation stream does not mean the task failed. Check terminal
    // truth first, and retry the transport only if work remains active.
    if (streamError) throw streamError;
    return { state: 'pending', remoteRunId, remoteStatus };
  }
  return {
    state: 'terminal',
    remoteRunId,
    remoteStatus,
    result: boundedResult(current),
    reasoning: typeof current.reasoning === 'string' && current.reasoning
      ? current.reasoning
      : undefined,
    summary: summaryOf(current),
    payload,
    usage: measuredUsageOf(current) ?? undefined,
  };
}

export async function stopRuntimeTask(
  env: Env,
  businessId: string,
  taskId: string,
  fetcher?: typeof globalThis.fetch,
): Promise<RunnerTaskResponse | null> {
  const { runtime, secrets } = await withTenant(env, businessId, async (tx) => {
    const runtime = await getRuntime(tx, businessId);
    return {
      runtime,
      secrets: runtime ? await getRuntimeSecrets(env, tx, businessId) : null,
    };
  });
  if (!runtime?.providerUrl) return null;
  if (!secrets) return null;
  const client = new RunnerClient({
    origin: runtime.providerUrl,
    runnerKey: secrets.runnerKey,
    edgeToken: runtime.provider === 'fly-sprite' ? env.SPRITES_TOKEN : undefined,
    fetch: fetcher,
  });
  return confirmedStop(await client.stop(taskId));
}

export async function decideRuntimeTaskApproval(
  env: Env,
  businessId: string,
  taskId: string,
  requestId: string,
  decision: 'approve' | 'deny',
  fetcher?: typeof globalThis.fetch,
): Promise<RunnerTaskResponse | null> {
  const { runtime, secrets } = await withTenant(env, businessId, async (tx) => {
    const runtime = await getRuntime(tx, businessId);
    return {
      runtime,
      secrets: runtime ? await getRuntimeSecrets(env, tx, businessId) : null,
    };
  });
  if (!runtime?.providerUrl || !secrets) return null;
  const client = new RunnerClient({
    origin: runtime.providerUrl,
    runnerKey: secrets.runnerKey,
    edgeToken: runtime.provider === 'fly-sprite' ? env.SPRITES_TOKEN : undefined,
    fetch: fetcher,
  });
  return client.decideApproval(taskId, requestId, decision);
}

export function measuredUsageOf(
  response: RunnerTaskResponse,
): { inputTokens: number; outputTokens: number } | null {
  const usage = response.usage;
  if (!usage || typeof usage !== 'object' ||
      !validToken(usage.input_tokens) || !validToken(usage.output_tokens)) return null;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

function runPayload(value: unknown): RunPayload {
  if (!value || typeof value !== 'object') throw new Error('runtime run payload is invalid');
  const body = value as Record<string, unknown>;
  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (!input || input.length > RUNNER_INPUT_MAX) throw new Error('runtime run input is invalid');
  const optional = (key: string, max: number): string | undefined => {
    if (body[key] === undefined) return undefined;
    if (typeof body[key] !== 'string' || body[key].length > max) {
      throw new Error(`runtime run ${key} is invalid`);
    }
    return body[key];
  };
  let profile: SpecialistProfile | undefined;
  if (body.profile !== undefined) {
    if (!specialistProfileValid(body.profile)) {
      throw new Error('runtime run profile is invalid');
    }
    profile = body.profile as SpecialistProfile;
  }
  return {
    input,
    instructions: optional('instructions', RUNNER_INSTRUCTIONS_MAX),
    profile,
    sessionId: optional('sessionId', 500),
    objective: optional('objective', 1_000),
    function: optional('function', 100),
    channel: optional('channel', 100),
    factKeys: stringArray(body.factKeys, 24, 200),
    grounded: typeof body.grounded === 'boolean' ? body.grounded : undefined,
    responseMode: body.responseMode === 'quick' || body.responseMode === 'deep'
      ? body.responseMode
      : undefined,
    selectedSkills: skillIds(body.selectedSkills),
    model: optional('model', 200),
    requestedAtMs: typeof body.requestedAtMs === 'number' &&
        Number.isFinite(body.requestedAtMs)
      ? body.requestedAtMs
      : undefined,
    telegram: telegramDelivery(body.telegram),
  };
}

function skillIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5 || value.some(id =>
    typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) ||
    new Set(value).size !== value.length) {
    throw new Error('runtime run selectedSkills is invalid');
  }
  return value as string[];
}

function telegramDelivery(value: unknown): RunPayload['telegram'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('runtime run telegram is invalid');
  const body = value as Record<string, unknown>;
  if (typeof body.connectionId !== 'string' || !uuid(body.connectionId) ||
      typeof body.chatId !== 'number' || !Number.isSafeInteger(body.chatId) ||
      typeof body.messageId !== 'number' || !Number.isSafeInteger(body.messageId) ||
      typeof body.from !== 'string' || !body.from || body.from.length > 200 ||
      typeof body.question !== 'string' || !body.question || body.question.length > 4_000 ||
      typeof body.privateChat !== 'boolean') {
    throw new Error('runtime run telegram is invalid');
  }
  return {
    connectionId: body.connectionId,
    chatId: body.chatId,
    messageId: body.messageId,
    from: body.from,
    question: body.question,
    privateChat: body.privateChat,
    liveMessageId: typeof body.liveMessageId === 'number' && Number.isSafeInteger(body.liveMessageId)
      ? body.liveMessageId
      : undefined,
  };
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems ||
      value.some((item) => typeof item !== 'string' || item.length > maxLength)) {
    throw new Error('runtime run factKeys is invalid');
  }
  return value as string[];
}

function boundedStatus(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 50).toLowerCase() : 'unknown';
}

function boundedResult(response: RunnerTaskResponse): unknown {
  const result = response.output ?? response.result ?? response.response ?? response.error ?? null;
  const encoded = JSON.stringify(result);
  if (encoded.length > 64 * 1024) return encoded.slice(0, 64 * 1024);
  return result;
}

function summaryOf(response: RunnerTaskResponse): string {
  const result = response.output ?? response.result ?? response.response ?? response.error ?? '';
  return (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 500);
}

function persistedTerminalOutcome(
  task: RuntimeTask,
  payload: RunPayload,
): RuntimeRunOutcome | null {
  const remoteStatus = boundedStatus(task.remoteStatus);
  if (!task.remoteRunId || !TERMINAL.has(remoteStatus) ||
      !task.result || typeof task.result !== 'object' || Array.isArray(task.result)) {
    return null;
  }
  const raw = (task.result as Record<string, unknown>).terminal_outcome;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const snapshot = raw as Record<string, unknown>;
  if (boundedStatus(snapshot.remoteStatus) !== remoteStatus || !('result' in snapshot)) return null;
  const result = boundedStoredResult(snapshot.result);
  const reasoning = typeof snapshot.reasoning === 'string' && snapshot.reasoning
    ? snapshot.reasoning.slice(0, 48_000)
    : undefined;
  const usage = persistedUsage(snapshot.usage);
  const summary = typeof snapshot.summary === 'string' && snapshot.summary
    ? snapshot.summary.slice(0, 500)
    : (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 500);
  return {
    state: 'terminal',
    remoteRunId: task.remoteRunId,
    remoteStatus,
    result,
    ...(reasoning ? { reasoning } : {}),
    summary,
    payload,
    ...(usage ? { usage } : {}),
  };
}

function boundedStoredResult(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return null;
  return encoded.length > 64 * 1024 ? encoded.slice(0, 64 * 1024) : value;
}

function persistedUsage(value: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  return validToken(usage.inputTokens) && validToken(usage.outputTokens)
    ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
    : null;
}

function validToken(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
