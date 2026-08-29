import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createRunner } from '../src/server.mjs';

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const TASK_2 = '33333333-3333-4333-8333-333333333333';
const RUNNER_KEY = 'r'.repeat(32);
const HERMES_KEY = 'hermes-secret';

let directory;
let hermesServer;
let runnerServer;
let hermesOrigin;
let runnerOrigin;
let hermesStatus;
let starts;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'aisar-runner-'));
  hermesStatus = 'running';
  starts = [];
  hermesServer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${HERMES_KEY}`);
    if (req.url === '/health/detailed') return reply(res, 200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/v1/runs') {
      const body = await bodyOf(req);
      starts.push(body);
      return reply(res, 202, { run_id: `run-${starts.length}`, status: 'started' });
    }
    if (req.url?.endsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of [
        { event: 'message.delta', delta: 'Hello' },
        { event: 'reasoning.available', text: 'private chain of thought' },
        { event: 'tool.started', tool: 'execute_code', preview: 'import urllib.request' },
        { event: 'tool.completed', tool: 'execute_code', duration: 1.25, error: false },
        { event: 'message.delta', delta: ' from Hermes' },
        { event: 'message.delta', delta: '\n<thi' },
        { event: 'message.delta', delta: 'nk>inline private reasoning' },
        { event: 'message.delta', delta: '</think>\nSafe answer' },
        { event: 'run.completed', output: 'terminal transcript must not cross' },
      ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
      return res.end();
    }
    if (req.method === 'POST' && req.url?.endsWith('/stop')) {
      hermesStatus = 'stopping';
      return reply(res, 200, { status: 'stopping' });
    }
    if (req.url?.startsWith('/v1/runs/')) {
      return reply(res, 200, { run_id: req.url.split('/').at(-1), status: hermesStatus });
    }
    return reply(res, 404, {});
  });
  hermesOrigin = await listen(hermesServer);

  runnerServer = createRunner({
    businessId: BUSINESS,
    runnerKey: RUNNER_KEY,
    hermesKey: HERMES_KEY,
    hermesOrigin,
    release: '2026.08.27-1',
    toolMode: 'full-tools',
    webSearchBackend: 'ddgs',
    stateFile: join(directory, 'state.json'),
  });
  runnerOrigin = await listen(runnerServer);
});

afterEach(async () => {
  await close(runnerServer);
  await close(hermesServer);
  await rm(directory, { recursive: true, force: true });
});

test('liveness reveals no credential and requires no runner key', async () => {
  const response = await fetch(`${runnerOrigin}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'aisar-agent-runner',
    release: '2026.08.27-1',
    toolMode: 'full-tools',
    webSearchBackend: 'ddgs',
    keepalive: {
      held: false,
      task: 'jentera-always-on',
      until: null,
      lastError: null,
    },
  });
});

test('detailed readiness requires the per-runtime key', async () => {
  assert.equal((await fetch(`${runnerOrigin}/readyz`)).status, 401);
  const response = await call('/readyz');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hermes.status, 'ok');
  assert.equal(body.webSearchBackend, 'ddgs');
  assert.equal(body.edgeAuthorizationForwarded, false);
  assert.equal(body.region, null);

  const simulatedForward = await fetch(`${runnerOrigin}/readyz`, {
    headers: {
      'X-Aisar-Runner-Key': RUNNER_KEY,
      Authorization: 'Bearer edge-credential-that-must-be-stripped',
    },
  });
  assert.equal((await simulatedForward.json()).edgeAuthorizationForwarded, true);

  const placed = await call('/readyz', { headers: { 'Fly-Region': 'SIN' } });
  assert.equal((await placed.json()).region, 'sin');
});

test('starts one Hermes run for a valid leased Jentera task', async () => {
  const response = await start(TASK);
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.hermesRunId, 'run-1');
  assert.deepEqual(starts[0], {
    input: 'Help the owner',
    session_id: 'business-thread',
    instructions: 'Propose actions; do not send them directly.',
    model_options: {
      reasoning: { enabled: true, effort: 'high' },
    },
  });
});

test('rejects missing, expired, incomplete, unexpected, and cross-task grants', async () => {
  for (const toolGrant of [
    undefined,
    grant(TASK, { issuedAt: 1, expiresAt: 2 }),
    grant(TASK, { operations: [] }),
    grant(TASK, { operations: ['telegram:send_message'] }),
    grant(TASK_2),
  ]) {
    const response = await start(TASK, { toolGrant });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /tool grant/);
  }
  assert.equal(starts.length, 0);
});

test('rejects a task for another business identity', async () => {
  const response = await start(TASK, { businessId: TASK });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /business/);
  assert.equal(starts.length, 0);
});

test('deduplicates the same task across requests', async () => {
  await start(TASK);
  const duplicate = await start(TASK);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(starts.length, 1);
});

test('allows only one active task, then releases after terminal status', async () => {
  await start(TASK);
  assert.equal((await start(TASK_2)).status, 409);
  hermesStatus = 'completed';
  assert.equal((await start(TASK_2)).status, 202);
  assert.equal(starts.length, 2);
});

test('polls and stops by Jentera task id without exposing Hermes directly', async () => {
  await start(TASK);
  const status = await call(`/v1/tasks/${TASK}`);
  assert.equal((await status.json()).status, 'running');
  const stopped = await call(`/v1/tasks/${TASK}/stop`, { method: 'POST' });
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).status, 'stopping');
});

test('streams Hermes-visible assistant and tool events without private internals', async () => {
  await start(TASK);
  const response = await call(`/v1/tasks/${TASK}/events`, {
    headers: { Accept: 'text/event-stream' },
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /"delta":"Hello"/);
  assert.match(stream, /"delta":" from Hermes"/);
  assert.match(stream, /"type":"tool.started"/);
  assert.match(stream, /"tool":"execute_code"/);
  assert.match(stream, /import urllib\.request/);
  assert.match(stream, /"type":"tool.completed"/);
  assert.match(stream, /Safe answer/);
  assert.doesNotMatch(
    stream,
    /chain of thought|terminal transcript|inline private reasoning|<think>/,
  );
  assert.match(stream, /"type":"done"/);

  const state = await readFile(join(directory, 'state.json'), 'utf8');
  assert.doesNotMatch(
    state,
    /Hello|Hermes|execute_code|urllib|chain of thought|terminal transcript|inline private reasoning|Safe answer/,
  );
});

const call = (path, init = {}) => fetch(`${runnerOrigin}${path}`, {
  ...init,
  headers: { 'X-Aisar-Runner-Key': RUNNER_KEY, ...(init.headers ?? {}) },
});

const start = (taskId, overrides = {}) => call('/v1/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    businessId: BUSINESS,
    taskId,
    leaseToken: 'lease-token-long-enough',
    input: 'Help the owner',
    sessionId: 'business-thread',
    instructions: 'Propose actions; do not send them directly.',
    toolGrant: grant(taskId),
    ...overrides,
  }),
});

function grant(taskId, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    businessId: BUSINESS,
    taskId,
    operations: ['*'],
    issuedAt: now,
    expiresAt: now + 300,
    nonce: randomUUID(),
    ...overrides,
  })).toString('base64url');
  const signature = createHmac('sha256', RUNNER_KEY).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
