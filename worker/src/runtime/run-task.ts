import type { Env } from '../env';
import { getRuntime, getRuntimeSecrets } from '../agent-runtime';
import { withTenant } from '../db';
import type { RuntimeProvider } from './provider';
import { runtimeProviderFor } from './provision';
import { RunnerClient, type RunnerTaskResponse } from './runner-client';
import type { RuntimeTask } from './tasks';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stopped']);

interface RunPayload {
  input: string;
  instructions?: string;
  sessionId?: string;
  objective?: string;
  function?: string;
  channel?: string;
}

export type RuntimeRunOutcome =
  | { state: 'pending'; remoteRunId: string; remoteStatus: string }
  | {
      state: 'terminal';
      remoteRunId: string;
      remoteStatus: string;
      result: unknown;
      summary: string;
      payload: RunPayload;
    };

export async function dispatchRuntimeRun(
  env: Env,
  task: RuntimeTask,
  leaseToken: string,
  options: { provider?: RuntimeProvider; fetch?: typeof globalThis.fetch } = {},
): Promise<RuntimeRunOutcome> {
  const payload = runPayload(task.payload);
  const { runtime, secrets } = await withTenant(env, task.businessId, async (tx) => ({
    runtime: await getRuntime(tx, task.businessId),
    secrets: await getRuntimeSecrets(env, tx, task.businessId),
  }));
  if (!runtime?.providerId || !runtime.providerUrl) throw new Error('runtime is not provisioned');
  if (!['ready', 'cold', 'idle', 'busy'].includes(runtime.status)) {
    throw new Error(`runtime is not dispatchable (${runtime.status})`);
  }

  const provider = options.provider ?? runtimeProviderFor(env);
  if (runtime.provider !== provider.id) {
    throw new Error(`runtime provider mismatch (${runtime.provider})`);
  }
  const observed = await provider.wake({
    provider: runtime.provider,
    id: runtime.providerId,
    name: runtime.providerName,
    url: runtime.providerUrl,
    state: runtime.status,
  });
  const client = new RunnerClient({
    origin: observed.url,
    runnerKey: secrets.runnerKey,
    edgeToken: runtime.provider === 'fly-sprite' ? env.SPRITES_TOKEN : undefined,
    fetch: options.fetch,
  });
  await client.ready();
  const started = await client.start({
    businessId: task.businessId,
    taskId: task.id,
    leaseToken,
    input: payload.input,
    sessionId: payload.sessionId,
    instructions: payload.instructions,
  });
  const remoteRunId = started.hermesRunId;
  if (!remoteRunId) throw new Error('runner returned no Hermes run id');

  const current = await client.status(task.id);
  const remoteStatus = boundedStatus(current.status);
  if (!TERMINAL.has(remoteStatus)) {
    return { state: 'pending', remoteRunId, remoteStatus };
  }
  return {
    state: 'terminal',
    remoteRunId,
    remoteStatus,
    result: boundedResult(current),
    summary: summaryOf(current),
    payload,
  };
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
  };
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
