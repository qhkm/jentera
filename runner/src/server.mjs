/* ============================================================
   AISAR's narrow, per-business boundary in front of Hermes.

   Hermes stays on loopback. The Sprite URL routes only to this
   process, whose task endpoint requires both the private Sprite URL
   token (at Fly's edge) and a separate per-runtime runner key.
   ============================================================ */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stopped']);
const BODY_LIMIT = 64 * 1024;

export function createRunner(input) {
  const config = validated(input);
  const state = new StateStore(config.stateFile);
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
        });
      }

      if (!sameSecret(req.headers['x-aisar-runner-key'], config.runnerKey)) {
        return json(res, 401, { ok: false, error: 'unauthorized' });
      }

      if (req.method === 'GET' && url.pathname === '/readyz') {
        const detail = await hermes(config, '/health/detailed');
        const body = await responseJson(detail);
        const ready = detail.ok && readiness(body);
        return json(res, ready ? 200 : 503, {
          ok: ready,
          release: config.release,
          toolMode: config.toolMode,
          edgeAuthorizationForwarded: typeof req.headers.authorization === 'string',
          hermes: boundedReadiness(body),
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/tasks') {
        const body = await readJson(req);
        const problem = taskProblem(body, config);
        if (problem) return json(res, 400, { ok: false, error: problem });

        const previous = await state.get(body.taskId);
        if (previous) {
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

      const taskPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})$/i);
      if (taskPath && req.method === 'GET') {
        const saved = await state.get(taskPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        const status = await hermes(config, `/v1/runs/${encodeURIComponent(saved.hermesRunId)}`);
        const result = await responseJson(status);
        if (!status.ok) return json(res, 502, { ok: false, error: 'Hermes status failed' });
        if (typeof result?.status === 'string') {
          await state.put(saved.taskId, { ...saved, status: result.status });
        }
        return json(res, 200, { ok: true, taskId: saved.taskId, ...result });
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
        await state.put(saved.taskId, { ...saved, status: result?.status ?? 'stopping' });
        return json(res, 200, { ok: true, taskId: saved.taskId, ...result });
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
    release: env.AISAR_RUNTIME_RELEASE,
    hermesKey: env.HERMES_API_KEY,
    hermesOrigin: env.HERMES_ORIGIN ?? 'http://127.0.0.1:8642',
    stateFile: env.AISAR_RUNNER_STATE ?? '/var/lib/aisar/runner-state.json',
    toolMode: env.AISAR_TOOL_MODE,
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
  if (config.toolMode !== 'no-tools') {
    throw new Error('AISAR_TOOL_MODE must be no-tools');
  }
  return {
    ...config,
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
      await state.put(saved.taskId, { ...saved, status: current.status });
      if (!TERMINAL.has(current.status)) return { ...saved, status: current.status };
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
      !Array.isArray(claims.operations) || claims.operations.length !== 0 ||
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

function readiness(body) {
  const top = String(body?.status ?? '').toLowerCase();
  const nested = String(body?.readiness?.status ?? '').toLowerCase();
  return ['ok', 'ready', 'healthy'].includes(top) || ['ok', 'ready', 'healthy'].includes(nested);
}

function boundedReadiness(body) {
  if (!body || typeof body !== 'object') return { status: 'unknown' };
  return {
    status: String(body.status ?? 'unknown').slice(0, 50),
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

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function uuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configFromEnv();
  const server = createRunner(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      event: 'runner.ready',
      port: config.port,
      release: config.release,
    }));
  });
}
