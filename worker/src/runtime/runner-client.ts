const RESPONSE_LIMIT = 256 * 1024;

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
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.origin.startsWith('https://') &&
        !this.origin.startsWith('http://127.0.0.1') &&
        !this.origin.startsWith('http://localhost')) {
      throw new Error('runner origin must use HTTPS');
    }
    if (this.runnerKey.length < 32) throw new Error('runner key is invalid');
  }

  async ready(): Promise<void> {
    await this.request('/readyz');
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
