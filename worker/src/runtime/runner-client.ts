import { createStepProgressExtractor } from './step-progress';
import { StreamingThinkScrubber } from './think-scrubber';
import type { ResponseMode } from './response-mode';
import { specialistProfileValid, type SpecialistProfile } from '../specialists';

const RESPONSE_LIMIT = 256 * 1024;
const STREAM_LIMIT = 64 * 1024;
const HERMES_PATCH_ID = 'jentera-runtime-2026-09-07';
const PROBE_TIMEOUT_MS = 3_000;
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'stopped', 'expired']);

export interface RunnerClientOptions {
  origin: string;
  runnerKey: string;
  edgeToken?: string;
  /** Desired immutable runtime release. Readiness must report this exact
      process-bound release before a task can be admitted. */
  expectedRelease?: string;
  /** Capabilities the runtime must attest on /readyz (e.g. ['computer_use']).
      Absent/empty accepts any runtime. Readiness failing to report one fails
      closed — a provisioned capability that is not actually running is never
      treated as ready. */
  expectedCapabilities?: string[];
  fetch?: typeof globalThis.fetch;
}

export interface RunnerTaskRequest {
  businessId: string;
  taskId: string;
  leaseToken: string;
  input: string;
  profile?: SpecialistProfile;
  sessionId?: string;
  instructions?: string;
  responseMode?: ResponseMode;
  model?: string;
  /** HMAC-signed, task-bound, five-minute capability grant. */
  toolGrant: string;
  /** ISO instant until which the runner should keep the Sprite active
      via the Tasks API (paid plans only). Omit for wake-on-request. */
  keepaliveUntil?: string;
  /** Absolute epoch-millisecond deadline for this run. The runner persists it
      before admission and keeps stopping Hermes until termination is
      confirmed; callers must not refresh it on retry. */
  deadlineAt?: number;
}

export interface RunnerTaskResponse {
  ok?: boolean;
  duplicate?: boolean;
  /** /readyz only: what configuration the runtime says it applied. Shape is
      checked by `configState` rather than trusted, because a diagnostic must
      not be able to fail a dispatch. */
  config?: unknown;
  taskId?: string;
  hermesRunId?: string;
  run_id?: string;
  status?: string;
  output?: unknown;
  /** Hermes's `last_reasoning` on terminal runs (48k-bounded by the runner).
      The consumer renders it as the durable `💭 **Reasoning:**` block. */
  reasoning?: unknown;
  result?: unknown;
  response?: unknown;
  error?: unknown;
  activeTaskId?: string;
  /** Runner-side admission stamp of the active task (epoch ms). Lets the
      worker tell \"momentarily busy\" from a wedged slot that outlived its
      age bound. */
  activeTaskStartedAt?: number | null;
  requestId?: string;
  decision?: 'approve' | 'deny';
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  toolMode?: string;
  webSearchBackend?: string;
  /** Capabilities the runner attests (e.g. ['computer_use']). */
  capabilities?: string[];
  specialistProfiles?: Record<string, unknown>;
  region?: string | null;
  edgeAuthorizationForwarded?: boolean;
  release?: string;
  runner?: {
    sourceSha256?: unknown;
    sourceAttested?: unknown;
    pid?: unknown;
    startedAt?: unknown;
  };
  hermes?: {
    jenteraPatch?: unknown;
  };
}

export interface RunnerReadiness {
  region: string | null;
  /** Capabilities the runner attested on /readyz (e.g. ['computer_use']). */
  capabilities: string[];
  specialistProfiles: SpecialistProfile[];
  /** What configuration the runtime says it is running, when it runs a bundle
      that fetches one. Null on every sprite until that release, and null again
      whenever the runner has only what the bootstrap gave it. Reported, never
      required: stale configuration must not fail a dispatch. */
  config: RunnerConfigState | null;
}

export interface RunnerConfigState {
  version: string | null;
  source: string | null;
  appliedAt: string | null;
  pendingVersion?: string;
  rejected?: string;
  staleSince?: string;
}

/** The isolated runtime is still finishing an earlier task. This is normal
    backpressure, not a failed model attempt, and callers should poll shortly. */
export class RuntimeBusyError extends Error {
  constructor(
    readonly activeTaskId?: string,
    readonly activeTaskStartedAt?: number | null,
  ) {
    super('business runtime is busy');
    this.name = 'RuntimeBusyError';
  }
}

/**
 * The runner's config attestation, kept only where it is well-formed.
 *
 * Deliberately forgiving. This is diagnostic: a runner that reports nothing,
 * or reports nonsense, must not be able to fail a dispatch — the run matters
 * and the version does not. Anything unrecognised becomes null and the caller
 * simply learns less.
 */
function configState(value: unknown): RunnerConfigState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof body[key] === 'string' && body[key] ? body[key] as string : null;
  const optional = (key: string): string | undefined =>
    typeof body[key] === 'string' && body[key] ? body[key] as string : undefined;
  const version = text('version');
  const source = text('source');
  if (!version && !source) return null;
  return {
    version,
    source,
    appliedAt: text('appliedAt'),
    ...(optional('pendingVersion') ? { pendingVersion: optional('pendingVersion') } : {}),
    ...(optional('rejected') ? { rejected: optional('rejected') } : {}),
    ...(optional('staleSince') ? { staleSince: optional('staleSince') } : {}),
  };
}

/** Authenticated client for Jentera's narrow per-business runner API. */
export class RunnerClient {
  private readonly origin: string;
  private readonly runnerKey: string;
  private readonly edgeToken?: string;
  private readonly expectedRelease?: string;
  private readonly expectedCapabilities?: string[];
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: RunnerClientOptions) {
    this.origin = options.origin.replace(/\/$/, '');
    this.runnerKey = options.runnerKey;
    this.edgeToken = options.edgeToken;
    this.expectedRelease = options.expectedRelease;
    this.expectedCapabilities = options.expectedCapabilities;
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    if (!this.origin.startsWith('https://') &&
        !this.origin.startsWith('http://127.0.0.1') &&
        !this.origin.startsWith('http://localhost')) {
      throw new Error('runner origin must use HTTPS');
    }
    if (this.runnerKey.length < 32) throw new Error('runner key is invalid');
  }

  async ready(): Promise<RunnerReadiness> {
    const body = await this.request('/readyz');
    if (this.expectedRelease && body.release !== this.expectedRelease) {
      throw new Error('runner did not attest the desired runtime release');
    }
    if (body.runner?.sourceAttested !== true ||
        typeof body.runner.sourceSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(body.runner.sourceSha256)) {
      throw new Error('runner did not attest the source loaded by this process');
    }
    if (body.hermes?.jenteraPatch !== HERMES_PATCH_ID) {
      throw new Error('runner did not attest the required Hermes runtime patch');
    }
    if (body.toolMode !== 'full-tools') {
      throw new Error('runner did not attest the required full-tools mode');
    }
    if (body.webSearchBackend !== 'ddgs') {
      throw new Error('runner did not attest an operational web-search backend');
    }
    if (body.edgeAuthorizationForwarded !== false) {
      throw new Error('runner did not attest edge credential isolation');
    }
    const specialistProfiles = Object.entries(body.specialistProfiles ?? {})
      .filter(([profile, ready]) => specialistProfileValid(profile) && ready === true)
      .map(([profile]) => profile);
    const attestedCapabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((id) => typeof id === 'string')
      : [];
    if (this.expectedCapabilities) {
      for (const id of this.expectedCapabilities) {
        if (!attestedCapabilities.includes(id)) {
          throw new Error(`runner did not attest the ${id} capability`);
        }
      }
    }
    const region = typeof body.region === 'string' && /^[a-z0-9]{3}$/i.test(body.region.trim())
      ? body.region.trim().toLowerCase()
      : null;
    return {
      region,
      capabilities: attestedCapabilities,
      specialistProfiles,
      config: configState(body.config),
    };
  }

  async start(task: RunnerTaskRequest): Promise<RunnerTaskResponse> {
    const body = await this.request('/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    }, [200, 202, 409]);
    if (body.error === 'runtime_busy') {
      throw new RuntimeBusyError(
        body.activeTaskId,
        typeof body.activeTaskStartedAt === 'number' ? body.activeTaskStartedAt : null,
      );
    }
    return body;
  }

  async status(taskId: string): Promise<RunnerTaskResponse> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  /** A lease may be reclaimed only when the runner positively reports that
      its task is terminal. Every ambiguous outcome fails closed so a network
      fault, timeout, or missing runner record can never steal a live run. */
  async probeRun(taskId: string): Promise<boolean> {
    try {
      const body = await this.request(
        `/v1/tasks/${encodeURIComponent(taskId)}`,
        {},
        [200],
        PROBE_TIMEOUT_MS,
      );
      return typeof body.status === 'string' && TERMINAL_TASK_STATUSES.has(body.status);
    } catch {
      return false;
    }
  }

  async stop(taskId: string): Promise<RunnerTaskResponse> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/stop`, {
      method: 'POST',
    });
  }

  async decideApproval(
    taskId: string,
    requestId: string,
    decision: 'approve' | 'deny',
    reason?: string,
  ): Promise<RunnerTaskResponse> {
    if (!safeApprovalRequestId(requestId)) throw new Error('runner approval request id is invalid');
    if (reason !== undefined && (decision !== 'deny' || !safeApprovalReason(reason))) {
      throw new Error('runner approval reason is invalid');
    }
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        decision,
        ...(decision === 'deny' && reason ? { reason: reason.trim() } : {}),
      }),
    });
  }

  /** Consume the runner's already-filtered presentation stream. Unknown event
      shapes are ignored; only bounded text, tool lifecycle, the bounded
      reasoning lane, and heartbeats cross. */
  async stream(
    taskId: string,
    handlers: {
      onDelta: (delta: string) => Promise<void>;
      onToolEvent?: (event: RunnerToolEvent) => Promise<void>;
      /** The real Hermes model-call iteration and configured ceiling. */
      onIteration?: (current: number, total: number) => Promise<void>;
      onHeartbeat?: () => Promise<void>;
      /** A complete `@step:` progress label the model emitted. */
      onProgress?: (label: string) => Promise<void>;
      /** A bounded slice of the model's live reasoning (runner-redacted). */
      onThinking?: (text: string) => Promise<void>;
      /** Called with the runner seq of every event relayed (not skipped), so
          the caller can persist where a slice stopped. */
      onSeq?: (seq: number) => void;
    },
    options: {
      /** The runner replays a task's whole history to every subscriber. A
          resumed slice passes the last seq it relayed and everything at or
          before it is dropped, so the web chat never sees an answer twice. */
      afterSeq?: number;
    } = {},
  ): Promise<RunnerApprovalRequest | null> {
    const afterSeq = options.afterSeq ?? 0;
    const response = await this.fetcher(
      `${this.origin}/v1/tasks/${encodeURIComponent(taskId)}/events`,
      {
        headers: {
          ...(this.edgeToken ? { Authorization: `Bearer ${this.edgeToken}` } : {}),
          'X-Aisar-Runner-Key': this.runnerKey,
          Accept: 'text/event-stream',
        },
        signal: AbortSignal.timeout(15 * 60 * 1_000),
      },
    );
    if (response.status !== 200 || !response.body ||
        !response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
      throw new Error(`runner stream failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let received = 0;
    let done = false;
    const steps = createStepProgressExtractor();
    const thinking = new StreamingThinkScrubber();
    try {
      while (!done) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        const frames = pending.split(/\r?\n\r?\n/);
        pending = frames.pop() ?? '';
        if (pending.length > STREAM_LIMIT) throw new Error('runner stream frame exceeded limit');
        for (const frame of frames) {
          const event = safeStreamEvent(frame);
          if (!event) continue;
          if (event.seq !== undefined) {
            if (event.seq <= afterSeq) continue;
            handlers.onSeq?.(event.seq);
          }
          if (event.type === 'done') {
            done = true;
            break;
          }
          if (event.type === 'heartbeat') {
            await handlers.onHeartbeat?.();
            continue;
          }
          if (event.type === 'approval') {
            received += event.requestId.length + event.tool.length + event.message.length;
            if (received > STREAM_LIMIT) throw new Error('runner stream exceeded limit');
            return event;
          }
          if (event.type === 'tool.started' || event.type === 'tool.completed') {
            received += event.tool.length + ('preview' in event ? event.preview?.length ?? 0 : 0);
            if (received > STREAM_LIMIT) throw new Error('runner stream exceeded limit');
            await handlers.onToolEvent?.(event);
            continue;
          }
          if (event.type === 'context.compressing') {
            await handlers.onProgress?.('Shortening conversation context before continuing…');
            continue;
          }
          if (event.type === 'iteration') {
            await handlers.onIteration?.(event.current, event.total);
            continue;
          }
          if (event.type === 'thinking') {
            received += event.text.length;
            if (received > STREAM_LIMIT) throw new Error('runner stream exceeded limit');
            await handlers.onThinking?.(event.text);
            continue;
          }
          /* Deltas may contain `@step:` narration lines; split them off so
             the answer lane never shows the agent's running commentary. */
          received += event.delta.length;
          if (received > STREAM_LIMIT) throw new Error('runner stream exceeded limit');
          const progress = steps.push(thinking.push(event.delta));
          for (const label of progress.steps) await handlers.onProgress?.(label);
          if (progress.rest) await handlers.onDelta(progress.rest);
        }
        if (chunk.done) break;
      }
      /* Flush any safe partial tag tail before the step extractor. An open
         reasoning block deliberately produces no tail. */
      const visibleTail = thinking.finish();
      if (visibleTail) {
        const progress = steps.push(visibleTail);
        for (const label of progress.steps) await handlers.onProgress?.(label);
        if (progress.rest) await handlers.onDelta(progress.rest);
      }
      /* The stream ended on an unterminated step line: flush it. */
      const tail = steps.flush();
      for (const label of tail.steps) await handlers.onProgress?.(label);
      if (tail.rest) await handlers.onDelta(tail.rest);
      return null;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  private async request(
    path: string,
    init: RequestInit = {},
    accepted: number[] = [200],
    timeoutMs = 30_000,
  ): Promise<RunnerTaskResponse> {
    const response = await this.fetcher(`${this.origin}${path}`, {
      ...init,
      headers: {
        ...(this.edgeToken ? { Authorization: `Bearer ${this.edgeToken}` } : {}),
        'X-Aisar-Runner-Key': this.runnerKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (text.length > RESPONSE_LIMIT) throw new Error('runner response exceeded limit');
    let body: RunnerTaskResponse = {};
    try {
      body = text ? JSON.parse(text) as RunnerTaskResponse : {};
    } catch {
      throw new Error(`runner returned invalid JSON (${response.status})`);
    }
    if (!accepted.includes(response.status)) {
      const detail = typeof body.error === 'string' ? `: ${body.error.slice(0, 200)}` : '';
      throw new Error(`runner request failed (${response.status})${detail}`);
    }
    return body;
  }
}

type SafeStreamEvent = (
  | { type: 'delta'; delta: string }
  | RunnerToolEvent
  | { type: 'iteration'; current: number; total: number }
  | { type: 'context.compressing' }
  | { type: 'thinking'; text: string }
  | RunnerApprovalRequest
  | { type: 'heartbeat' }
  | { type: 'done' }
) & { seq?: number };

export type RunnerToolEvent =
  (| { type: 'tool.started'; tool: string; preview?: string }
  | { type: 'tool.completed'; tool: string; duration: number; error: boolean }) & { seq?: number };

export interface RunnerApprovalRequest {
  type: 'approval';
  requestId: string;
  tool: string;
  message: string;
}

function safeStreamEvent(frame: string): SafeStreamEvent | null {
  const data = frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data.length > 16 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  const shaped = shapedStreamEvent(event);
  if (!shaped) return null;
  /* The runner numbers every history event; heartbeats and `done` carry none. */
  return Number.isSafeInteger(event.seq) && Number(event.seq) >= 0
    ? { ...shaped, seq: Number(event.seq) }
    : shaped;
}

function shapedStreamEvent(event: Record<string, unknown>): SafeStreamEvent | null {
  if (event.type === 'heartbeat') return { type: 'heartbeat' };
  if (event.type === 'context.compressing') return { type: 'context.compressing' };
  if (event.type === 'done') return { type: 'done' };
  if (event.type === 'iteration' && Number.isSafeInteger(event.current) &&
      Number.isSafeInteger(event.total) && Number(event.current) >= 1 &&
      Number(event.current) <= Number(event.total) && Number(event.total) <= 10_000) {
    return {
      type: 'iteration',
      current: Number(event.current),
      total: Number(event.total),
    };
  }
  if (event.type === 'tool.started' && safeToolName(event.tool)) {
    return {
      type: 'tool.started',
      tool: event.tool as string,
      ...(typeof event.preview === 'string' && event.preview.length <= 1_000
        ? { preview: event.preview }
        : {}),
    };
  }
  if (event.type === 'tool.completed' && safeToolName(event.tool) &&
      typeof event.duration === 'number' && Number.isFinite(event.duration) &&
      typeof event.error === 'boolean') {
    return {
      type: 'tool.completed',
      tool: event.tool as string,
      duration: Math.max(0, Math.min(900, event.duration)),
      error: event.error,
    };
  }
  if (event.type === 'delta' && typeof event.delta === 'string' &&
      event.delta.length > 0 && event.delta.length <= 8 * 1024) {
    return { type: 'delta', delta: event.delta };
  }
  if (event.type === 'thinking' && typeof event.text === 'string' &&
      event.text.length > 0 && event.text.length <= 8 * 1024) {
    return { type: 'thinking', text: event.text };
  }
  if (event.type === 'approval' && safeApprovalRequestId(event.requestId) &&
      safeToolName(event.tool) && typeof event.message === 'string' &&
      event.message.length > 0 && event.message.length <= 1_000) {
    return {
      type: 'approval',
      requestId: event.requestId,
      tool: event.tool,
      message: event.message,
    };
  }
  return null;
}

function safeToolName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(value);
}

function safeApprovalRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value);
}

function safeApprovalReason(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    new TextEncoder().encode(value.trim()).byteLength <= 1_000 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}
