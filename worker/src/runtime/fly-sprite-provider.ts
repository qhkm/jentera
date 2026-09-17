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
  comment?: string;
  is_auto?: boolean;
}

/* A checkpoint we made has a versioned id, v1, v2, ... The list also carries
   the live state as an entry named Current, newer than everything else, and
   hourly auto snapshots named auto-<epoch>. Restoring to Current is restoring
   to whatever the sprite holds right now, which is no rollback at all. */
const VERSIONED_CHECKPOINT = /^v\d+$/;

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
        // Never make Hermes public. The Jentera Worker authenticates with
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

  async lookup(name: string): Promise<ObservedRuntime | null> {
    return this.get(name, true);
  }

  async checkpoint(runtime: ObservedRuntime, comment = 'Jentera known-good'): Promise<string> {
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
    const checkpoints = ((await listed.json()) as CheckpointWire[])
      .filter((entry) => !entry.is_auto && VERSIONED_CHECKPOINT.test(entry.id));
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
    options: { env?: string[]; dir?: string; onOutput?: (text: string) => Promise<void> } = {},
  ): Promise<RuntimeExecResult> {
    const spareCheck = command === '/.sprite/bin/node' &&
      args[0] === '/home/sprite/aisar/runner/spare-state.mjs' && args[1] === 'claim' && args.length === 5 &&
      /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$/.test(args[2]!) && /^[0-9a-f]{40}$/.test(args[3]!) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args[4]!);
    if (command !== '/home/sprite/aisar/runner/bootstrap-runtime.sh' && command !== '/bin/bash' && !spareCheck) {
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
    return readHttpExec(response, options.onOutput);
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
  const detail = redactSecrets((await res.text().catch(() => '')).slice(0, 500));
  return new Error(`${action} failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

/* Upstream providers occasionally echo the offending request — including
   an Authorization header or a URL containing a key — in their error
   bodies. Sprites errors land in run traces and owner-visible messages,
   so scrub the shapes that matter before they leave this file. */
function redactSecrets(text: string): string {
  const bearer =
    /\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi;
  const keyValue =
    /\b(api[_-]?key|access[_-]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;"']+/gi;
  return text
    .replace(bearer, '$1[redacted]')
    .replace(keyValue, '$1=[redacted]');
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
  if (failed) throw new Error(redactSecrets(failed.error ?? failed.data ?? 'Sprite operation failed'));
}

async function readHttpExec(response: Response, onOutput?: (text: string) => Promise<void>): Promise<RuntimeExecResult> {
  /* HTTP exec is the provider-supported escape hatch for environments such as
     Workers that cannot keep a long-lived outbound WebSocket attached. The
     response ends with the two-byte exit frame: stream 3, then exit code.

     The current protocol does not length-prefix output frames, so intermediaries
     may coalesce them. Bootstrap output is diagnostic only; correctness comes
     from the terminal exit frame and subsequent authenticated readiness probe. */
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Sprite bootstrap HTTP stream has no body');
  let bytes = new Uint8Array(0);
  let firstStream: number | undefined;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstStream === undefined && value.length) firstStream = value[0];
      const joined = new Uint8Array(bytes.length + value.length);
      joined.set(bytes); joined.set(value, bytes.length);
      bytes = joined.slice(-128 * 1024 - 2);
      if (onOutput) await onOutput(decoder.decode(value, { stream: true }));
    }
    if (onOutput) await onOutput(decoder.decode());
  } finally { reader.releaseLock(); }
  if (bytes.length < 2 || bytes[bytes.length - 2] !== 3) {
    throw new Error('Sprite bootstrap HTTP stream ended without an exit frame');
  }
  const exitCode = bytes[bytes.length - 1];
  const output = bytes.subarray(0, -2);
  const stream = firstStream;
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
    throw new Error(`Sprite bootstrap exited ${exitCode}: ${redactSecrets(detail.slice(-500))}`);
  }
  return result;
}
