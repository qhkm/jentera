const RESPONSE_LIMIT = 256 * 1024;
const STREAM_LIMIT = 64 * 1024;

export interface RunnerClientOptions {
  origin: string;
  runnerKey: string;
  edgeToken?: string;
  fetch?: typeof globalThis.fetch;
}

export interface RunnerTaskRequest {
  businessId: string;
  taskId: string;
  leaseToken: string;
  input: string;
  sessionId?: string;
  instructions?: string;
  /** HMAC-signed, task-bound, five-minute capability grant. */
  toolGrant: string;
}

export interface RunnerTaskResponse {
  ok?: boolean;
  duplicate?: boolean;
  taskId?: string;
  hermesRunId?: string;
  run_id?: string;
  status?: string;
  output?: unknown;
  result?: unknown;
  response?: unknown;
  error?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  toolMode?: string;
  edgeAuthorizationForwarded?: boolean;
}

/** Authenticated client for AISAR's narrow per-business runner API. */
export class RunnerClient {
  private readonly origin: string;
  private readonly runnerKey: string;
  private readonly edgeToken?: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: RunnerClientOptions) {
    this.origin = options.origin.replace(/\/$/, '');
    this.runnerKey = options.runnerKey;
    this.edgeToken = options.edgeToken;
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    if (!this.origin.startsWith('https://') &&
        !this.origin.startsWith('http://127.0.0.1') &&
        !this.origin.startsWith('http://localhost')) {
      throw new Error('runner origin must use HTTPS');
    }
    if (this.runnerKey.length < 32) throw new Error('runner key is invalid');
  }

  async ready(): Promise<void> {
    const body = await this.request('/readyz');
    if (body.toolMode !== 'no-tools') {
      throw new Error('runner did not attest the required no-tools mode');
    }
    if (body.edgeAuthorizationForwarded !== false) {
      throw new Error('runner did not attest edge credential isolation');
    }
  }

  async start(task: RunnerTaskRequest): Promise<RunnerTaskResponse> {
    return this.request('/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    }, [200, 202]);
  }

  async status(taskId: string): Promise<RunnerTaskResponse> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  async stop(taskId: string): Promise<RunnerTaskResponse> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/stop`, {
      method: 'POST',
    });
  }

  /** Consume the runner's already-filtered assistant stream. Unknown event
      shapes are ignored; only bounded text deltas and heartbeats cross. */
  async stream(
    taskId: string,
    handlers: {
      onDelta: (delta: string) => Promise<void>;
      onHeartbeat?: () => Promise<void>;
    },
  ): Promise<void> {
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
          if (event.type === 'done') {
            done = true;
            break;
          }
          if (event.type === 'heartbeat') {
            await handlers.onHeartbeat?.();
            continue;
          }
          received += event.delta.length;
          if (received > STREAM_LIMIT) throw new Error('runner stream exceeded limit');
          await handlers.onDelta(event.delta);
        }
        if (chunk.done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  private async request(
    path: string,
    init: RequestInit = {},
    accepted: number[] = [200],
  ): Promise<RunnerTaskResponse> {
    const response = await this.fetcher(`${this.origin}${path}`, {
      ...init,
      headers: {
        ...(this.edgeToken ? { Authorization: `Bearer ${this.edgeToken}` } : {}),
        'X-Aisar-Runner-Key': this.runnerKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
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

type SafeStreamEvent =
  | { type: 'delta'; delta: string }
  | { type: 'heartbeat' }
  | { type: 'done' };

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
  if (event.type === 'heartbeat') return { type: 'heartbeat' };
  if (event.type === 'done') return { type: 'done' };
  if (event.type === 'delta' && typeof event.delta === 'string' &&
      event.delta.length > 0 && event.delta.length <= 8 * 1024) {
    return { type: 'delta', delta: event.delta };
  }
  return null;
}
