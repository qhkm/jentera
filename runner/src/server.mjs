/* ============================================================
   Jentera's narrow, per-business boundary in front of Hermes.

   Hermes stays on loopback. The Sprite URL routes only to this
   process, whose task endpoint requires both the private Sprite URL
   token (at Fly's edge) and a separate per-runtime runner key.
   ============================================================ */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stopped']);
const BODY_LIMIT = 64 * 1024;
const STREAM_TEXT_LIMIT = 64 * 1024;
const STREAM_EVENT_LIMIT = 8 * 1024;
const STREAM_THINK_LIMIT = 8 * 1024;
const STREAM_TTL_MS = 5 * 60 * 1000;
const HERMES_PATCH_ID = 'jentera-runtime-2026-09-01';
const RUNNER_STARTED_AT = new Date().toISOString();
/* Computed while this module is being loaded, so an old process cannot begin
   reporting a new on-disk bundle after provisioning overwrites server.mjs. */
const RUNNER_SOURCE_SHA256 = createHash('sha256')
  .update(readFileSync(new URL(import.meta.url)))
  .digest('hex');
/** Cap on concurrent SSE consumers of one task stream. Each subscriber
    holds a socket and a 1s heartbeat interval, so an unbounded set is a
    slow resource leak a hostile network peer could trigger for free. */
const MAX_STREAM_SUBSCRIBERS = 16;

/* ============================================================
   Always-on hold (paid plans). The worker includes an ISO
   `keepaliveUntil` on dispatches for `pro` businesses. While the
   clock is before that instant we hold the Sprite active through the
   Tasks API on the management socket, so the next message skips the
   cold-wake penalty. When the instant passes we delete the task and
   the Sprite is free to pause (stops billing).

   https://docs.sprites.dev/concepts/tasks
   ============================================================ */

const KEEPALIVE_TASK = 'jentera-always-on';
const KEEPALIVE_EXPIRE = '1h';
const KEEPALIVE_REFRESH_MS = 10 * 60 * 1000;
const SPRITE_API_SOCK_DEFAULT = '/.sprite/api.sock';

export function createSpriteKeepalive(sockPath = SPRITE_API_SOCK_DEFAULT) {
  return new SpriteKeepalive(sockPath);
}

export class SpriteKeepalive {
  constructor(sockPath) {
    this.sockPath = sockPath;
    this.holdUntilMs = 0;
    this.held = false;
    this.timer = null;
    this.socket = null; // null = unknown, true = present, false = absent
    this.lastError = null;
  }

  /** Extend the hold. ISO instant or undefined (ignored). Only ever
      moves the deadline forward; earlier arm calls are retained.
      Instants already in the past are ignored (the worker only sends
      future windows; a released Sprite stays released).
      Returns the tick promise (internally caught; safe to ignore). */
  arm(untilIso) {
    const ms = typeof untilIso === 'string' ? Date.parse(untilIso) : Number.NaN;
    if (Number.isNaN(ms) || ms <= Date.now()) return Promise.resolve();
    this.holdUntilMs = Math.max(this.holdUntilMs, ms);
    this.ensureLoop();
    return this.tick(); // hold starts immediately, not after the interval
  }

  status() {
    return {
      held: this.held,
      task: KEEPALIVE_TASK,
      until: this.held && this.holdUntilMs > Date.now()
        ? new Date(this.holdUntilMs).toISOString()
        : null,
      lastError: this.lastError,
    };
  }

  ensureLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), KEEPALIVE_REFRESH_MS);
    this.timer.unref?.();
  }

  stopLoop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    try {
      if (this.socket === null) {
        try {
          await access(this.sockPath);
          this.socket = true;
        } catch {
          this.socket = false;
          console.warn(
            `[keepalive] no Sprite management socket (${this.sockPath}); always-on unavailable`,
          );
        }
      }
      if (!this.socket) {
        this.stopLoop();
        return;
      }

      if (Date.now() >= this.holdUntilMs) {
        if (this.held) {
          const res = await spriteTasksApi(this.sockPath, 'DELETE', KEEPALIVE_TASK);
          if (res.ok || res.status === 404) {
            this.held = false;
            console.info('[keepalive] released; sprite free to pause');
          } else {
            this.lastError = `delete ${res.status}`;
            console.warn(`[keepalive] delete failed (${res.status})`);
          }
        } else {
          this.stopLoop();
        }
        return;
      }

      const created = await spriteTasksApi(this.sockPath, 'POST', undefined, {
        name: KEEPALIVE_TASK,
        expire: KEEPALIVE_EXPIRE,
      });
      if (created.ok) {
        if (!this.held) {
          this.held = true;
          console.info(`[keepalive] holding sprite active until ${new Date(this.holdUntilMs).toISOString()}`);
        }
        return;
      }
      if (created.status === 409) { // already held: refresh the expiry
        const refreshed = await spriteTasksApi(this.sockPath, 'PUT', KEEPALIVE_TASK, {
          expire: KEEPALIVE_EXPIRE,
        });
        if (refreshed.ok) {
          if (!this.held) {
            this.held = true;
            console.info(`[keepalive] holding sprite active until ${new Date(this.holdUntilMs).toISOString()}`);
          }
          return;
        }
        this.lastError = `refresh ${refreshed.status}`;
        console.warn(`[keepalive] refresh failed (${refreshed.status})`);
        return;
      }
      this.lastError = `create ${created.status}`;
      console.warn(`[keepalive] create failed (${created.status})`);
    } catch (error) {
      this.lastError = String(error);
      console.warn('[keepalive] tick failed', error);
    }
  }
}

/** One Tasks API call over the Sprite management socket. */
function spriteTasksApi(sockPath, method, name, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest(
      {
        socketPath: sockPath,
        host: 'sprite',
        path: name ? `/v1/tasks/${encodeURIComponent(name)}` : '/v1/tasks',
        method,
        headers: payload === null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: data,
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

export function createRunner(input) {
  const config = validated(input);
  const state = new StateStore(config.stateFile);
  const streams = new SafeDeltaStreams(config);
  const keepalive = createSpriteKeepalive(process.env.SPRITE_API_SOCK);
  let admitting = false;

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://runner');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, {
          ok: true,
          service: 'aisar-agent-runner',
          release: config.release,
          toolMode: config.toolMode,
          webSearchBackend: config.webSearchBackend,
          keepalive: keepalive.status(),
        });
      }

      if (!sameSecret(req.headers['x-aisar-runner-key'], config.runnerKey)) {
        return json(res, 401, { ok: false, error: 'unauthorized' });
      }

      /* Defense in depth: the Fly edge token in the Sprite URL is also
         forwarded as `Authorization: Bearer` by the worker. When the
         runtime was provisioned with AISAR_EDGE_TOKEN, both factors are
         required — a leaked runner key alone must not admit anyone onto
         the private network. Runtimes provisioned before this existed
         carry no token and keep the single-factor check until they are
         re-provisioned. */
      if (
        config.edgeToken &&
        !sameSecret(authorizationBearer(req.headers.authorization), config.edgeToken)
      ) {
        return json(res, 401, { ok: false, error: 'unauthorized' });
      }

      if (req.method === 'GET' && url.pathname === '/readyz') {
        const detail = await hermes(config, '/health/detailed');
        const body = await responseJson(detail);
        const ready = detail.ok && readiness(body) && config.runnerSourceAttested;
        return json(res, ready ? 200 : 503, {
          ok: ready,
          release: config.release,
          toolMode: config.toolMode,
          webSearchBackend: config.webSearchBackend,
          region: runtimeRegion(req),
          edgeAuthorizationForwarded: typeof req.headers.authorization === 'string',
          edgeTokenEnforced: Boolean(config.edgeToken),
          runner: {
            sourceSha256: RUNNER_SOURCE_SHA256,
            sourceAttested: config.runnerSourceAttested,
            pid: process.pid,
            startedAt: RUNNER_STARTED_AT,
          },
          hermes: boundedReadiness(body),
          keepalive: keepalive.status(),
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/tasks') {
        const body = await readJson(req);
        const problem = taskProblem(body, config);
        if (problem) return json(res, 400, { ok: false, error: problem });

        keepalive.arm(body.keepaliveUntil); // paid-plan always-on hold

        const previous = await state.get(body.taskId);
        if (previous) {
          if (!TERMINAL.has(previous.status)) {
            streams.start(previous.taskId, previous.hermesRunId);
          }
          return json(res, 200, {
            ok: true,
            duplicate: true,
            taskId: body.taskId,
            hermesRunId: previous.hermesRunId,
            status: previous.status,
          });
        }

        const active = await activeTask(config, state);
        if (active || admitting) {
          return json(res, 409, {
            ok: false,
            error: 'runtime_busy',
            activeTaskId: active?.taskId,
          });
        }
        admitting = true;
        try {
          const started = await hermes(config, '/v1/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: body.input,
              session_id: body.sessionId,
              instructions: body.instructions,
              model: body.model ?? (body.responseMode === 'quick'
                ? config.modelName
                : config.deepModelName),
              model_options: {
                reasoning: body.responseMode === 'quick'
                  ? { enabled: false }
                  : { enabled: true, effort: 'high' },
              },
            }),
          });
          const result = await responseJson(started);
          if (!started.ok || typeof result?.run_id !== 'string') {
            return json(res, 502, { ok: false, error: 'Hermes refused the run' });
          }

          await state.put(body.taskId, {
            taskId: body.taskId,
            businessId: body.businessId,
            hermesRunId: result.run_id,
            status: typeof result.status === 'string' ? result.status : 'started',
            leaseHash: hash(body.leaseToken),
            grantNonceHash: hash(grantClaims(body.toolGrant).nonce),
          });
          streams.start(body.taskId, result.run_id);
          return json(res, 202, {
            ok: true,
            taskId: body.taskId,
            hermesRunId: result.run_id,
            status: result.status ?? 'started',
          });
        } finally {
          admitting = false;
        }
      }

      const eventsPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/events$/i);
      if (eventsPath && req.method === 'GET') {
        const saved = await state.get(eventsPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        streams.start(saved.taskId, saved.hermesRunId);
        return streams.pipe(saved.taskId, req, res);
      }

      const taskPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})$/i);
      if (taskPath && req.method === 'GET') {
        const saved = await state.get(taskPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        const status = await hermes(config, `/v1/runs/${encodeURIComponent(saved.hermesRunId)}`);
        const result = await responseJson(status);
        if (!status.ok) {
          const terminal = savedTerminalStatus(saved);
          return terminal
            ? json(res, 200, { ok: true, taskId: saved.taskId, ...terminal })
            : json(res, 502, { ok: false, error: 'Hermes status failed' });
        }
        const observed = await persistObservedStatus(state, saved, result);
        return json(res, 200, { ok: true, taskId: saved.taskId, ...observed });
      }

      const stopPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/stop$/i);
      if (stopPath && req.method === 'POST') {
        const saved = await state.get(stopPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        const stopped = await hermes(
          config,
          `/v1/runs/${encodeURIComponent(saved.hermesRunId)}/stop`,
          { method: 'POST' },
        );
        const result = await responseJson(stopped);
        if (!stopped.ok) return json(res, 502, { ok: false, error: 'Hermes stop failed' });
        const observed = await persistObservedStatus(state, saved, result ?? { status: 'stopping' });
        return json(res, 200, { ok: true, taskId: saved.taskId, ...observed });
      }

      return json(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      const status = error?.code === 'BODY_TOO_LARGE' ? 413 : 500;
      console.error(JSON.stringify({ event: 'runner.error', message: String(error?.message ?? error) }));
      return json(res, status, { ok: false, error: status === 413 ? 'body too large' : 'runner error' });
    }
  });
}

export function configFromEnv(env = process.env) {
  return {
    businessId: env.AISAR_BUSINESS_ID,
    runnerKey: env.AISAR_RUNNER_KEY,
    edgeToken: env.AISAR_EDGE_TOKEN,
    release: env.AISAR_RUNTIME_RELEASE,
    hermesKey: env.HERMES_API_KEY,
    hermesOrigin: env.HERMES_ORIGIN ?? 'http://127.0.0.1:8642',
    stateFile: env.AISAR_RUNNER_STATE ?? '/var/lib/aisar/runner-state.json',
    toolMode: env.AISAR_TOOL_MODE,
    webSearchBackend: env.AISAR_WEB_SEARCH_BACKEND,
    modelName: env.AISAR_MODEL_NAME,
    deepModelName: env.AISAR_DEEP_MODEL_NAME,
    runnerSourceSha256: env.AISAR_RUNNER_SOURCE_SHA256,
    port: Number(env.PORT ?? 8080),
  };
}

function validated(config) {
  if (!uuid(config.businessId)) throw new Error('AISAR_BUSINESS_ID must be a UUID');
  if (typeof config.runnerKey !== 'string' || config.runnerKey.length < 32) {
    throw new Error('AISAR_RUNNER_KEY must be at least 32 characters');
  }
  if (typeof config.hermesKey !== 'string' || config.hermesKey.length < 8) {
    throw new Error('HERMES_API_KEY must be at least 8 characters');
  }
  if (typeof config.release !== 'string' || !config.release.trim()) {
    throw new Error('AISAR_RUNTIME_RELEASE is required');
  }
  if (config.toolMode !== 'full-tools') {
    throw new Error('AISAR_TOOL_MODE must be full-tools');
  }
  if (config.webSearchBackend !== 'ddgs') {
    throw new Error('AISAR_WEB_SEARCH_BACKEND must be ddgs');
  }
  if (!modelId(config.modelName) || !modelId(config.deepModelName)) {
    throw new Error('AISAR model routing is not configured');
  }
  const expectedSource = config.runnerSourceSha256 ?? RUNNER_SOURCE_SHA256;
  if (!/^[0-9a-f]{64}$/.test(expectedSource)) {
    throw new Error('AISAR_RUNNER_SOURCE_SHA256 must be a SHA-256 digest');
  }
  if (expectedSource !== RUNNER_SOURCE_SHA256) {
    throw new Error('running runner source does not match the provisioned bundle');
  }
  return {
    ...config,
    runnerSourceAttested: true,
    hermesOrigin: String(config.hermesOrigin).replace(/\/$/, ''),
    stateFile: String(config.stateFile),
  };
}

async function activeTask(config, state) {
  for (const saved of await state.all()) {
    if (TERMINAL.has(saved.status)) continue;
    const response = await hermes(config, `/v1/runs/${encodeURIComponent(saved.hermesRunId)}`);
    if (!response.ok) return saved;
    const current = await responseJson(response);
    if (typeof current?.status === 'string') {
      const observed = await persistObservedStatus(state, saved, current);
      if (!TERMINAL.has(observed.status)) return { ...saved, status: observed.status };
    } else {
      return saved;
    }
  }
  return null;
}

function taskProblem(body, config) {
  if (!body || typeof body !== 'object') return 'invalid JSON object';
  if (body.businessId !== config.businessId) return 'business does not match runtime identity';
  if (!uuid(body.taskId)) return 'taskId must be a UUID';
  if (typeof body.leaseToken !== 'string' || body.leaseToken.length < 16) {
    return 'leaseToken is required';
  }
  if (typeof body.input !== 'string' || !body.input.trim() || body.input.length > 20_000) {
    return 'input must contain 1 to 20000 characters';
  }
  if (body.sessionId !== undefined && typeof body.sessionId !== 'string') {
    return 'sessionId must be a string';
  }
  if (body.instructions !== undefined && typeof body.instructions !== 'string') {
    return 'instructions must be a string';
  }
  if (body.responseMode !== undefined &&
      body.responseMode !== 'quick' && body.responseMode !== 'deep') {
    return 'responseMode must be quick or deep';
  }
  if (body.model !== undefined &&
      body.model !== config.modelName && body.model !== config.deepModelName) {
    return 'model is not in the configured runtime routes';
  }
  if (body.keepaliveUntil !== undefined) {
    if (typeof body.keepaliveUntil !== 'string' ||
        !Number.isFinite(Date.parse(body.keepaliveUntil))) {
      return 'keepaliveUntil must be a valid ISO instant';
    }
  }
  const grant = validateGrant(body.toolGrant, config, body.taskId);
  if (grant) return grant;
  return null;
}

function validateGrant(token, config, taskId, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 4096) return 'tool grant is required';
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    return 'tool grant is invalid';
  }
  const expected = createHmac('sha256', config.runnerKey).update(parts[0]).digest();
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return 'tool grant is invalid';
  }
  let claims;
  try {
    claims = grantClaims(token);
  } catch {
    return 'tool grant is invalid';
  }
  if (claims.version !== 1 || claims.businessId !== config.businessId ||
      claims.taskId !== taskId || !uuid(claims.taskId) ||
      !Array.isArray(claims.operations) || claims.operations.length !== 1 ||
      claims.operations[0] !== '*' ||
      !Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt) ||
      claims.issuedAt > now + 30 || claims.expiresAt <= now ||
      claims.expiresAt - claims.issuedAt > 300 ||
      typeof claims.nonce !== 'string' || !uuid(claims.nonce)) {
    return 'tool grant is invalid or expired';
  }
  return null;
}

function grantClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

async function hermes(config, path, init = {}) {
  return fetch(`${config.hermesOrigin}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.hermesKey}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function hermesEvents(config, runId) {
  return fetch(`${config.hermesOrigin}/v1/runs/${encodeURIComponent(runId)}/events`, {
    headers: {
      Authorization: `Bearer ${config.hermesKey}`,
      Accept: 'text/event-stream',
    },
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
}

function readiness(body) {
  const top = String(body?.status ?? '').toLowerCase();
  const nested = String(body?.readiness?.status ?? '').toLowerCase();
  const healthy = ['ok', 'ready', 'healthy'].includes(top) ||
    ['ok', 'ready', 'healthy'].includes(nested);
  return healthy && body?.jentera_patch === HERMES_PATCH_ID;
}

function boundedReadiness(body) {
  if (!body || typeof body !== 'object') return { status: 'unknown' };
  return {
    status: String(body.status ?? 'unknown').slice(0, 50),
    jenteraPatch: typeof body.jentera_patch === 'string'
      ? body.jentera_patch.slice(0, 100)
      : undefined,
    pid: Number.isSafeInteger(body.pid) && body.pid > 0 ? body.pid : undefined,
    readiness: body.readiness && typeof body.readiness === 'object'
      ? { status: String(body.readiness.status ?? 'unknown').slice(0, 50) }
      : undefined,
  };
}

function sameSecret(value, expected) {
  if (Array.isArray(value) || typeof value !== 'string') return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pull the `Bearer …` token out of an Authorization header, or ''. */
function authorizationBearer(value) {
  if (Array.isArray(value) || typeof value !== 'string') return '';
  const match = value.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i);
  return match ? match[1] : '';
}

function runtimeRegion(req) {
  const raw = process.env.FLY_REGION ?? req.headers['fly-region'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && /^[a-z0-9]{3}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function uuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function modelId(value) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._:~-]+)?$/.test(value);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error('body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function responseJson(response) {
  return response.json().catch(() => null);
}

/** Hermes run status carries tool outputs the dashboard never renders.
    Surface only the fields the worker's status transition actually uses:
    `status`, `error`, `usage`, timestamp keys, the final answer `output`
    (bounded), and — for the durable reasoning block — Hermes's
    `last_reasoning` as a bounded `reasoning` string (the worker collapses
    it to 15 lines). Never a raw `...result` spread. */
function boundedTaskStatus(result) {
  if (!result || typeof result !== 'object') return { status: 'unknown' };
  const out = {};
  if (typeof result.status === 'string' && result.status) {
    out.status = result.status.slice(0, 50).toLowerCase();
  }
  if (typeof result.error === 'string' && result.error) {
    out.error = result.error.slice(0, 2_000);
  }
  if (result.usage && typeof result.usage === 'object') {
    const usage = {};
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
      const value = result.usage[key];
      if (Number.isSafeInteger(value) && value >= 0) usage[key] = value;
    }
    if (Object.keys(usage).length) out.usage = usage;
  }
  /* Final answer text: pass it through bounded (the worker slices to 4k).
     Hermes exposes it only once the run is terminal. */
  if (typeof result.output === 'string' && result.output) {
    out.output = result.output.slice(0, 64_000);
  }
  /* Final-message reasoning: Hermes computes `last_reasoning` at
     turn_finalizer.py:696 and the api_server ships it on the completed
     non-stream run status as `reasoning`. Bounded like output; the worker
     renders the `💭 **Reasoning:**` block for the durable answer. This is a
     deliberate terminal-status surface — the live SSE thinking lane stays
     the separate bounded slice. */
  if (typeof result.reasoning === 'string' && result.reasoning) {
    out.reasoning = result.reasoning.slice(0, 48_000);
  }
  for (const key of Object.keys(result)) {
    if (/^(created|started|finished|completed|updated)(_at)?$/i.test(key)) {
      const value = result[key];
      if (typeof value === 'string') out[key] = value.slice(0, 100);
      else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
  }
  return out;
}

/** Persist only the bounded terminal presentation. Hermes reaps completed run
    records independently of Jentera Queue redelivery; the task row is the
    durable bridge that keeps a finished answer recoverable after that 404. */
async function persistObservedStatus(state, saved, result) {
  const observed = boundedTaskStatus(result);
  const status = typeof observed.status === 'string' ? observed.status : 'unknown';
  await state.put(saved.taskId, {
    ...saved,
    status,
    ...(TERMINAL.has(status) ? { terminal: observed } : {}),
  });
  return observed;
}

/** State is private and mode 0600, but still re-validate and re-bound it before
    putting persisted bytes back on the network. */
function savedTerminalStatus(saved) {
  const terminal = boundedTaskStatus(saved?.terminal);
  return typeof terminal.status === 'string' && TERMINAL.has(terminal.status)
    ? terminal
    : null;
}

function json(res, status, body) {
  if (res.headersSent) return;
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(encoded);
}

class StateStore {
  constructor(file) {
    this.file = file;
    this.writeChain = Promise.resolve();
  }

  async get(taskId) {
    return (await this.read()).tasks[taskId] ?? null;
  }

  async all() {
    return Object.values((await this.read()).tasks);
  }

  async put(taskId, value) {
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.read();
      data.tasks[taskId] = value;
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    return this.writeChain;
  }

  async read() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      return parsed && typeof parsed.tasks === 'object' ? parsed : { version: 1, tasks: {} };
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, tasks: {} };
      throw error;
    }
  }
}

/**
 * The sole subscriber to Hermes's destructive run-event queue.
 *
 * Assistant text deltas, Hermes's bounded tool lifecycle presentation events,
 * and the bounded reasoning lane are copied into process memory. Approvals,
 * tool results, full arguments, terminal transcripts, and every unknown event
 * are dropped here. Nothing in this class touches the state file.
 */
class SafeDeltaStreams {
  constructor(config) {
    this.config = config;
    this.streams = new Map();
  }

  start(taskId, runId) {
    const existing = this.streams.get(taskId);
    if (existing) return existing;
    const stream = {
      taskId,
      runId,
      nextSeq: 1,
      bytes: 0,
      thinkBytes: 0,
      history: [],
      subscribers: new Set(),
      scrubber: new StreamingThinkScrubber(),
      done: false,
    };
    this.streams.set(taskId, stream);
    void this.pump(stream);
    return stream;
  }

  pipe(taskId, req, res) {
    const stream = this.streams.get(taskId);
    if (!stream) return json(res, 404, { ok: false, error: 'stream not found' });
    if (stream.subscribers.size >= MAX_STREAM_SUBSCRIBERS) {
      return json(res, 429, { ok: false, error: 'too many stream subscribers' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    for (const event of stream.history) writeSse(res, event);
    if (stream.done) {
      writeSse(res, { type: 'done' });
      res.end();
      return;
    }

    stream.subscribers.add(res);
    const heartbeat = setInterval(() => writeSse(res, { type: 'heartbeat' }), 1_000);
    heartbeat.unref?.();
    const close = () => {
      clearInterval(heartbeat);
      stream.subscribers.delete(res);
    };
    req.once('close', close);
    res.once('close', close);
  }

  async pump(stream) {
    try {
      const response = await hermesEvents(this.config, stream.runId);
      if (!response.ok || !response.body) return;
      let pending = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        const frames = pending.split(/\r?\n\r?\n/);
        pending = frames.pop() ?? '';
        for (const frame of frames) this.acceptFrame(stream, frame);
      }
      pending += decoder.decode();
      if (pending.trim()) this.acceptFrame(stream, pending);
    } catch {
      /* Final status polling remains authoritative. Stream loss degrades the
         preview, never task completion, and no provider error is logged. */
    } finally {
      this.finish(stream);
    }
  }

  acceptFrame(stream, frame) {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event?.event === 'message.delta' && typeof event.delta === 'string' &&
        event.delta.length > 0) {
      const bounded = truncateUtf8(event.delta, STREAM_TEXT_LIMIT - stream.bytes);
      /* Inline think blocks are scrubbed and discarded — only Hermes's native
         reasoning.available lane crosses as `thinking` (bounded, sanitised).
         Draining here keeps the capture buffer from growing across blocks. */
      stream.scrubber.drainThinking();
      this.emitDelta(stream, stream.scrubber.push(bounded));
      return;
    }
    if (event?.event === 'reasoning.available' && typeof event.text === 'string') {
      this.emitThinking(stream, event.text);
      return;
    }
    if (event?.event === 'tool.started') {
      const tool = safeToolName(event.tool);
      if (!tool) return;
      const preview = safeToolPreview(event.preview);
      this.emitEvent(stream, {
        type: 'tool.started',
        seq: stream.nextSeq++,
        tool,
        ...(preview ? { preview } : {}),
      });
      return;
    }
    if (event?.event === 'tool.completed') {
      const tool = safeToolName(event.tool);
      if (!tool) return;
      this.emitEvent(stream, {
        type: 'tool.completed',
        seq: stream.nextSeq++,
        tool,
        duration: Number.isFinite(event.duration)
          ? Math.max(0, Math.min(900, Number(event.duration)))
          : 0,
        error: event.error === true,
      });
    }
  }

  emitDelta(stream, value) {
    if (!value || stream.bytes >= STREAM_TEXT_LIMIT ||
        stream.history.length >= STREAM_EVENT_LIMIT) return;
    const delta = truncateUtf8(value, STREAM_TEXT_LIMIT - stream.bytes);
    if (!delta) return;
    this.emitEvent(stream, { type: 'delta', seq: stream.nextSeq++, delta });
  }

  /** Forwards Hermes's bounded reasoning lane as a separate `thinking` event
   *  with its own byte budget, so model CoT never spends the answer lane's
   *  budget. Reasoning text is sanitised and credential-redacted like tool
   *  previews. The worker renders it live in the bubble; it never crosses
   *  into the durable task status or output. */
  emitThinking(stream, value) {
    if (!value || stream.thinkBytes >= STREAM_THINK_LIMIT ||
        stream.history.length >= STREAM_EVENT_LIMIT) return;
    const text = safeToolPreview(value);
    if (!text) return;
    const safe = { type: 'thinking', seq: stream.nextSeq++, text };
    const size = Buffer.byteLength(JSON.stringify(safe));
    if (stream.thinkBytes + size > STREAM_THINK_LIMIT) return;
    stream.thinkBytes += size;
    stream.history.push(safe);
    for (const subscriber of stream.subscribers) writeSse(subscriber, safe);
  }

  emitEvent(stream, safe) {
    if (stream.history.length >= STREAM_EVENT_LIMIT) return;
    const size = Buffer.byteLength(JSON.stringify(safe));
    if (stream.bytes + size > STREAM_TEXT_LIMIT) return;
    stream.bytes += size;
    stream.history.push(safe);
    for (const subscriber of stream.subscribers) writeSse(subscriber, safe);
  }

  finish(stream) {
    if (stream.done) return;
    /* Order matters: finish() flushes a stream-ending open block's tail into
       the scrubber's captured thinking (discarded, per the inline-never-cross
       contract), then the answer tail itself. */
    const tail = stream.scrubber.finish();
    stream.scrubber.drainThinking();
    this.emitDelta(stream, tail);
    stream.done = true;
    for (const subscriber of stream.subscribers) {
      writeSse(subscriber, { type: 'done' });
      subscriber.end();
    }
    stream.subscribers.clear();
    const cleanup = setTimeout(() => this.streams.delete(stream.taskId), STREAM_TTL_MS);
    cleanup.unref?.();
  }
}

/** Streaming equivalent of Hermes's own think-block filter. It holds partial
 * tags across model chunks and never lets inline reasoning cross the runner's
 * trust boundary, even when Hermes labels it as a message delta. Inline
 * think-block content is captured (not silently dropped) and drained on the
 * next message delta / stream finish — the stream path discards it (only
 * Hermes's native reasoning.available lane crosses as SSE `thinking`),
 * which keeps the answer lane clean and inline CoT private. Capture is
 * retained so scrub behaviour is observable/testable. */
export class StreamingThinkScrubber {
  /* Pipe-framed markers are the convention inline models are prompted with
     (│ thinking│ … │/thinking│, ASCII-pipe variant accepted); bare ` thinking`
     … ` response` markers cover Hermes's own scratchpad lines; the XML tags
     cover classic CoT probes. */
  static OPEN = [
    '<reasoning_scratchpad>', '<think>', '<mm:think>', '| thinking|', ' thinking',
    '<reasoning>', '<thinking>', '<thought>',
  ];

  static CLOSE = [
    '</reasoning_scratchpad>', '</think>', '</mm:think>', '|/thinking|', '|/thinking ',
    ' response', '</reasoning>', '</thinking>', '</thought>',
  ];

  constructor() {
    this.buffer = '';
    this.inThinkBlock = false;
    this.visible = '';
    this.thinking = '';
  }

  push(text) {
    let input = normalizeSoftPipes(`${this.buffer}${text}`);
    this.buffer = '';
    let output = '';

    while (input) {
      const lower = input.toLowerCase();
      if (this.inThinkBlock) {
        const close = earliestTag(lower, StreamingThinkScrubber.CLOSE);
        if (close) {
          this.thinking += input.slice(0, close.index);
          this.buffer = '';
          this.inThinkBlock = false;
          input = input.slice(close.index + close.length);
          continue;
        }
        const max = Math.max(...StreamingThinkScrubber.CLOSE.map((tag) => tag.length));
        const tail = Math.min(max, input.length);
        if (input.length > tail) this.thinking += input.slice(0, input.length - tail);
        this.buffer = input.slice(-tail);
        return output;
      }

      const open = this.earliestOpening(input, lower);
      if (open) {
        output += this.append(input.slice(0, open.index));
        this.inThinkBlock = true;
        input = input.slice(open.index + open.length);
        continue;
      }

      /* Hold partial orphan closing tags too. Model providers may remove an
         opening reasoning tag upstream while leaving a namespaced close such
         as `</mm:think>` in message.delta, split across arbitrary chunks. */
      const held = longestTagPrefix(
        lower,
        [...StreamingThinkScrubber.OPEN, ...StreamingThinkScrubber.CLOSE],
      );
      const safe = held ? input.slice(0, -held) : input;
      if (held) this.buffer = input.slice(-held);
      output += this.append(stripOrphanCloseTags(safe));
      return output;
    }
    return output;
  }

  /** Returns captured inline think-block content since the last drain. Bytes
   * already counted in the scrubber's private state; the caller forwards it
   * through the bounded thinking lane. */
  drainThinking() {
    const value = this.thinking;
    this.thinking = '';
    return value;
  }

  finish() {
    if (this.inThinkBlock) {
      /* Stream ended inside a block: flush the held tail so the last working
         isn't lost, then return nothing for the answer lane. */
      this.thinking += this.buffer;
      this.buffer = '';
      return '';
    }
    const output = this.append(stripOrphanCloseTags(this.buffer));
    this.buffer = '';
    return output;
  }

  append(text) {
    this.visible += text;
    return text;
  }

  earliestOpening(input, lower) {
    let best = null;
    for (const tag of StreamingThinkScrubber.OPEN) {
      let from = 0;
      while (from < lower.length) {
        const index = lower.indexOf(tag, from);
        if (index === -1) break;
        const preceding = input.slice(0, index);
        const lastNewline = preceding.lastIndexOf('\n');
        const boundary = index === 0
          ? this.visible.length === 0 || this.visible.endsWith('\n')
          : lastNewline === -1
            ? (this.visible.length === 0 || this.visible.endsWith('\n')) && prefixBlank(preceding)
            : prefixBlank(preceding.slice(lastNewline + 1));
        if (boundary && (!best || index < best.index)) {
          best = { index, length: tag.length };
          break;
        }
        from = index + 1;
      }
    }
    return best;
  }
}

function earliestTag(text, tags) {
  let best = null;
  for (const tag of tags) {
    const index = text.indexOf(tag);
    if (index !== -1 && (!best || index < best.index)) {
      best = { index, length: tag.length };
    }
  }
  return best;
}

function longestTagPrefix(text, tags) {
  let held = 0;
  for (const tag of tags) {
    for (let length = 1; length < tag.length; length += 1) {
      if (text.endsWith(tag.slice(0, length))) held = Math.max(held, length);
    }
  }
  return held;
}

function stripOrphanCloseTags(text) {
  if (!text.includes('</')) return text;
  return text.replace(
    /<\/(?:[a-z][\w.-]*:)?(?:reasoning_scratchpad|think|reasoning|thinking|thought)>[ \t\r\n]*/gi,
    '',
  );
}

/** True when a line contains only soft-frame characters (│ or ASCII |) and
 * whitespace — lets pipe-framed markers be recognised even when a stray pipe
 * rides the same line. */
function prefixBlank(line) {
  return line.replace(/[│|]/g, '').trim() === '';
}

/** Maps soft box-drawing pipes to ASCII so one marker vocabulary matches
 * regardless of which the model emits. */
function normalizeSoftPipes(value) {
  return value.replace(/[│┃┆┊]/g, '|');
}

function writeSse(res, event) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function truncateUtf8(value, maxBytes) {
  const encoded = Buffer.from(value);
  if (encoded.length <= maxBytes) return value;
  return encoded.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/, '');
}

function safeToolName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,96}$/.test(value)) return '';
  return value;
}

function safeToolPreview(value) {
  if (typeof value !== 'string') return '';
  return truncateUtf8(value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]'), 1_000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configFromEnv();
  const server = createRunner(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      event: 'runner.ready',
      port: config.port,
      release: config.release,
      sourceSha256: RUNNER_SOURCE_SHA256,
    }));
  });
}
