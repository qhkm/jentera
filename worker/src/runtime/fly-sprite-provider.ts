import type {
  BootstrapRuntimeProvider,
  DesiredRuntime,
  ObservedRuntime,
  RuntimeExecResult,
  RuntimeState,
} from './provider';

interface SpriteWire {
  id: string;
  name: string;
  url: string;
  status: string;
}

interface CheckpointWire {
  id: string;
  create_time?: string;
}

export interface FlySpriteProviderOptions {
  token: string;
  apiOrigin?: string;
  fetch?: typeof globalThis.fetch;
}

/** Workers-compatible Sprites REST client; no CLI or Node process. */
export class FlySpriteProvider implements BootstrapRuntimeProvider {
  readonly id = 'fly-sprite' as const;
  private readonly token: string;
  private readonly apiOrigin: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: FlySpriteProviderOptions) {
    if (!options.token.trim()) throw new Error('SPRITES_TOKEN is required');
    this.token = options.token;
    this.apiOrigin = (options.apiOrigin ?? 'https://api.sprites.dev').replace(/\/$/, '');
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async create(desired: DesiredRuntime): Promise<ObservedRuntime> {
    const res = await this.request('/v1/sprites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: desired.name,
        wait_for_capacity: true,
        // Never make Hermes public. The AISAR Worker authenticates with
        // the organization token and the runner has its own task lease.
        url_settings: { auth: 'sprite' },
      }),
    });

    if (res.ok) return this.observed((await res.json()) as SpriteWire);

    /* Sprites has returned both 400 and 409 for an existing name across
       API releases. Resolve the exact resource before treating either as
       idempotent, so an invalid name or unrelated conflict still fails. */
    if (res.status === 400 || res.status === 409) {
      const existing = await this.get(desired.name, true);
      if (existing) return existing;
    }
    throw await apiError('create Sprite', res);
  }

  async wake(runtime: ObservedRuntime): Promise<ObservedRuntime> {
    const res = await this.fetcher(`${runtime.url.replace(/\/$/, '')}/healthz`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw await apiError('wake Sprite runner', res);
    return { ...runtime, state: 'ready' };
  }

  async stop(_runtime: ObservedRuntime): Promise<void> {
    /* Sprites sleep automatically after activity stops. There is no
       compute-stop endpoint; closing the task/HTTP request is the
       provider-correct implementation of release. */
  }

  async status(runtime: ObservedRuntime): Promise<ObservedRuntime> {
    const observed = await this.get(runtime.name, false);
    if (!observed) throw new Error(`Sprite ${runtime.name} no longer exists`);
    return observed;
  }

  async checkpoint(runtime: ObservedRuntime, comment = 'AISAR known-good'): Promise<string> {
    const created = await this.request(
      `/v1/sprites/${encodeURIComponent(runtime.name)}/checkpoint`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      },
    );
    if (!created.ok) throw await apiError('create Sprite checkpoint', created);
    await assertStreamSucceeded(created);

    /* The create stream announces completion but does not return a
       stable structured id. The list endpoint does. */
    const listed = await this.request(
      `/v1/sprites/${encodeURIComponent(runtime.name)}/checkpoints`,
    );
    if (!listed.ok) throw await apiError('list Sprite checkpoints', listed);
    const checkpoints = (await listed.json()) as CheckpointWire[];
    if (checkpoints.length === 0) throw new Error('Sprite created no checkpoint');
    checkpoints.sort((a, b) => (b.create_time ?? '').localeCompare(a.create_time ?? ''));
    return checkpoints[0].id;
  }

  async restore(runtime: ObservedRuntime, checkpointId: string): Promise<void> {
    const res = await this.request(
      `/v1/sprites/${encodeURIComponent(runtime.name)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
      { method: 'POST' },
    );
    if (!res.ok) throw await apiError('restore Sprite checkpoint', res);
    await assertStreamSucceeded(res);
  }

  async destroy(runtime: ObservedRuntime): Promise<void> {
    const res = await this.request(`/v1/sprites/${encodeURIComponent(runtime.name)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) throw await apiError('destroy Sprite', res);
  }

  async writeFile(
    runtime: ObservedRuntime,
    path: string,
    data: string,
    mode: number,
  ): Promise<void> {
    if (!safeRuntimePath(path)) throw new Error('runtime write path is not allowed');
    const query = new URLSearchParams({
      path,
      workingDir: '/',
      mode: mode.toString(8).padStart(4, '0'),
      mkdirParents: 'true',
    });
    const response = await this.request(
      `/v1/sprites/${encodeURIComponent(runtime.name)}/fs/write?${query}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data,
      },
    );
    if (!response.ok) throw await apiError('write Sprite runtime file', response);
  }

  async exec(
    runtime: ObservedRuntime,
    command: string,
    args: string[] = [],
    options: { env?: string[]; dir?: string } = {},
  ): Promise<RuntimeExecResult> {
    if (command !== '/home/sprite/aisar/runner/bootstrap-runtime.sh' && command !== '/bin/bash') {
      throw new Error('runtime bootstrap command is not allowed');
    }
    const url = new URL(
      `${this.apiOrigin}/v1/sprites/${encodeURIComponent(runtime.name)}/exec`,
    );
    for (const value of [command, ...args]) url.searchParams.append('cmd', value);
    url.searchParams.set('path', command);
    url.searchParams.set('stdin', 'false');
    if (options.dir) url.searchParams.set('dir', options.dir);
    for (const value of options.env ?? []) url.searchParams.append('env', value);

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw await apiError('exec Sprite bootstrap', response);
    }
    return readHttpExec(response);
  }

  private async get(name: string, allowMissing: boolean): Promise<ObservedRuntime | null> {
    const res = await this.request(`/v1/sprites/${encodeURIComponent(name)}`);
    if (allowMissing && res.status === 404) return null;
    if (!res.ok) throw await apiError('get Sprite', res);
    return this.observed((await res.json()) as SpriteWire);
  }

  private observed(sprite: SpriteWire): ObservedRuntime {
    return {
      provider: this.id,
      id: sprite.id,
      name: sprite.name,
      url: sprite.url,
      state: spriteState(sprite.status),
    };
  }

  private request(path: string, init: RequestInit = {}) {
    return this.fetcher(`${this.apiOrigin}${path}`, {
      ...init,
      headers: { ...this.authHeaders(), ...(init.headers ?? {}) },
    });
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }
}

function safeRuntimePath(path: string): boolean {
  const prefix = '/home/sprite/aisar/';
  if (!path.startsWith(prefix)) return false;
  const parts = path.slice(prefix.length).split('/');
  return parts.length > 0 && parts.every((part) =>
    part.length > 0 && part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part));
}

function spriteState(status: string): RuntimeState {
  switch (status.toLowerCase()) {
    case 'cold':
    case 'suspended':
      return 'cold';
    case 'running':
    case 'warm':
    case 'ready':
      return 'ready';
    case 'creating':
    case 'provisioning':
      return 'provisioning';
    case 'waking':
      return 'waking';
    default:
      return 'error';
  }
}

async function apiError(action: string, res: Response): Promise<Error> {
  const detail = (await res.text().catch(() => '')).slice(0, 500);
  return new Error(`${action} failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

async function assertStreamSucceeded(res: Response): Promise<void> {
  const text = await res.text();
  if (!text.trim()) return;

  let events: { type?: string; error?: string; data?: string }[];
  try {
    const parsed = JSON.parse(text) as unknown;
    events = Array.isArray(parsed) ? parsed : [parsed as typeof events[number]];
  } catch {
    events = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as typeof events[number]);
  }
  const failed = events.find((event) => event.type === 'error');
  if (failed) throw new Error(failed.error ?? failed.data ?? 'Sprite operation failed');
}

async function readHttpExec(response: Response): Promise<RuntimeExecResult> {
  /* HTTP exec is the provider-supported escape hatch for environments such as
     Workers that cannot keep a long-lived outbound WebSocket attached. The
     response ends with the two-byte exit frame: stream 3, then exit code.

     The current protocol does not length-prefix output frames, so intermediaries
     may coalesce them. Bootstrap output is diagnostic only; correctness comes
     from the terminal exit frame and subsequent authenticated readiness probe. */
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 2 || bytes[bytes.length - 2] !== 3) {
    throw new Error('Sprite bootstrap HTTP stream ended without an exit frame');
  }
  const exitCode = bytes[bytes.length - 1];
  const output = bytes.subarray(0, -2);
  const stream = output[0];
  const detail = new TextDecoder()
    .decode(stream === 1 || stream === 2 ? output.subarray(1) : output)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(-128 * 1024);
  const result = {
    exitCode,
    stdout: stream === 2 ? '' : detail,
    stderr: stream === 2 ? detail : '',
  };
  if (exitCode !== 0) {
    throw new Error(`Sprite bootstrap exited ${exitCode}: ${detail.slice(-500)}`);
  }
  return result;
}
