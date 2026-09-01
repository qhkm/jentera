import type { Env } from '../env';
import { getRuntime, getRuntimeAccess, getRuntimeSecrets } from '../agent-runtime';
import { withTenant } from '../db';
import type { RuntimeProvider } from './provider';
import { runtimeProviderFor } from './provision';
import { RunnerClient, type RunnerTaskResponse, type RunnerToolEvent } from './runner-client';
import { recordRuntimeTaskRemoteRun, type RuntimeTask } from './tasks';
import { issueFullToolsGrant } from './tool-grant';
import { markRuntimeUsageStarted, reserveRuntimeUsage } from './usage';
import { runtimeTaskIsCancelled } from './tasks';
import { append } from '../runs';
import type { ResponseMode } from './response-mode';
import { modelForResponseMode } from './response-mode';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stopped']);

/** Every dispatch holds the Sprite active this long past the dispatch
    (all plans — launch posture). Each dispatch refreshes the window, so a
    messaging business stays always-on and a silent one releases itself
    (stops billing) after the grace window. */
const KEEPALIVE_GRACE_HOURS_DEFAULT = 24;

function keepaliveGraceHours(env: Env): number {
  const value = Number(env.AISAR_KEEPALIVE_GRACE_HOURS);
  return Number.isFinite(value) && value > 0 ? value : KEEPALIVE_GRACE_HOURS_DEFAULT;
}

export interface RunPayload {
  input: string;
  instructions?: string;
  sessionId?: string;
  objective?: string;
  function?: string;
  channel?: string;
  factKeys?: string[];
  grounded?: boolean;
  responseMode?: ResponseMode;
  model?: string;
  requestedAtMs?: number;
  telegram?: {
    connectionId: string;
    chatId: number;
    messageId: number;
    from: string;
    question: string;
    privateChat: boolean;
  };
}

export type RuntimeRunOutcome =
  | { state: 'pending'; remoteRunId: string; remoteStatus: string }
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
    onHeartbeat?: () => Promise<void>;
    /** A complete `@step:` progress label the model emitted. */
    onProgress?: (label: string) => Promise<void>;
    /** A bounded slice of the model's live reasoning (runner-redacted). */
    onThinking?: (text: string) => Promise<void>;
    onStage?: (stage: string, elapsedMs: number) => void;
  } = {},
): Promise<RuntimeRunOutcome> {
  const dispatchStartedAt = Date.now();
  const stage = (name: string) => options.onStage?.(name, Date.now() - dispatchStartedAt);
  const payload = runPayload(task.payload);
  const model = payload.model ?? modelForResponseMode(env, payload.responseMode ?? 'deep');
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
      const keepaliveUntil = new Date(
        Date.now() + keepaliveGraceHours(env) * 3_600_000,
      ).toISOString();
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
  await client.ready();
  stage('runner_ready');
  if (Date.now() - reservation.startedAt.getTime() > reservation.maxRunSeconds * 1_000) {
    if (!task.remoteRunId) {
      throw new Error('runtime task exceeded its time limit before Hermes started');
    }
    await client.stop(task.id).catch(() => {});
    return {
      state: 'terminal',
      remoteRunId: task.remoteRunId,
      remoteStatus: 'cancelled',
      result: { error: 'runtime task exceeded its time limit' },
      summary: 'Runtime task exceeded its time limit.',
      payload,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
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
    responseMode: payload.responseMode,
    model,
    toolGrant,
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
        onHeartbeat: options.onHeartbeat,
        onProgress: options.onProgress,
        onThinking: options.onThinking,
      }).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }))
    : null;
  const cancelled = await withTenant(env, task.businessId, (tx) =>
    runtimeTaskIsCancelled(tx, task.businessId, task.id));
  if (cancelled) {
    await client.stop(task.id).catch(() => {});
    await streamResult;
    return {
      state: 'terminal',
      remoteRunId,
      remoteStatus: 'cancelled',
      result: { error: 'runtime task was cancelled' },
      summary: 'Runtime task was cancelled.',
      payload,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (streamResult) {
    const streamed = await streamResult;
    if (!streamed.ok) throw streamed.error;
    stage('stream_finished');
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
  return client.stop(taskId);
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
  if (!input || input.length > 20_000) throw new Error('runtime run input is invalid');
  const optional = (key: string, max: number): string | undefined => {
    if (body[key] === undefined) return undefined;
    if (typeof body[key] !== 'string' || body[key].length > max) {
      throw new Error(`runtime run ${key} is invalid`);
    }
    return body[key];
  };
  return {
    input,
    instructions: optional('instructions', 20_000),
    sessionId: optional('sessionId', 500),
    objective: optional('objective', 1_000),
    function: optional('function', 100),
    channel: optional('channel', 100),
    factKeys: stringArray(body.factKeys, 24, 200),
    grounded: typeof body.grounded === 'boolean' ? body.grounded : undefined,
    responseMode: body.responseMode === 'quick' || body.responseMode === 'deep'
      ? body.responseMode
      : undefined,
    model: optional('model', 200),
    requestedAtMs: typeof body.requestedAtMs === 'number' &&
        Number.isFinite(body.requestedAtMs)
      ? body.requestedAtMs
      : undefined,
    telegram: telegramDelivery(body.telegram),
  };
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
