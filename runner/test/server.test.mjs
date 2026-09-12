import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createRunner, configFromEnv } from '../src/server.mjs';

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
let hermesReasoning;
let hermesPatch;
let hermesRunMissing;
let starts;
let hermesPaths;
let hermesEventsList;
let approvalRequests;
let stopRequests;
let stopFailureStatus;
let startBarrier;
let browserPaused;
let browserCommands;
let browserBarrier;
let ensureBarrier;
let ensureCalls;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'aisar-runner-'));
  hermesStatus = 'running';
  hermesReasoning = 'The user asks a biographical question.\nKeep the answer focused and factual.';
  hermesPatch = 'jentera-runtime-2026-09-07';
  hermesRunMissing = false;
  starts = [];
  hermesPaths = [];
  approvalRequests = [];
  stopRequests = 0;
  stopFailureStatus = 0;
  startBarrier = null;
  browserPaused = false;
  browserCommands = [];
  browserBarrier = null;
  ensureBarrier = null;
  ensureCalls = 0;
  hermesEventsList = [
    { event: 'message.delta', delta: 'Hello' },
    { event: 'reasoning.available', text: 'private chain of thought' },
    { event: 'iteration.started', iteration: 12, max_iterations: 20 },
    { event: 'tool.started', tool: 'execute_code', preview: 'import urllib.request' },
    { event: 'tool.completed', tool: 'execute_code', duration: 1.25, error: false },
    { event: 'message.delta', delta: ' from Hermes' },
    { event: 'message.delta', delta: '\n<thi' },
    { event: 'message.delta', delta: 'nk>inline private reasoning' },
    { event: 'message.delta', delta: '</think>\nSafe answer' },
    { event: 'run.completed', output: 'terminal transcript must not cross' },
  ];
  hermesServer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${HERMES_KEY}`);
    hermesPaths.push(req.url);
    const requestPath = req.url?.replace(/^\/p\/(?:operations|customers|growth|records)/, '');
    if (requestPath === '/health/detailed') {
      return reply(res, 200, {
        status: 'ok',
        jentera_patch: hermesPatch,
        pid: 321,
        readiness: {
          status: 'ok',
          checks: { background_queues: { active_api_runs: 0 } },
        },
      });
    }
    if (req.method === 'POST' && requestPath === '/v1/runs') {
      const body = await bodyOf(req);
      starts.push(body);
      if (startBarrier) await startBarrier;
      return reply(res, 202, { run_id: `run-${starts.length}`, status: 'started' });
    }
    if (requestPath?.endsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of hermesEventsList) res.write(`data: ${JSON.stringify(event)}\n\n`);
      return res.end();
    }
    if (req.method === 'POST' && requestPath?.endsWith('/approval')) {
      approvalRequests.push(await bodyOf(req));
      hermesStatus = 'running';
      return reply(res, 200, {
        object: 'hermes.run.approval_response',
        run_id: requestPath.split('/').at(-2),
        choice: approvalRequests.at(-1).choice,
        resolved: 1,
      });
    }
    if (req.method === 'POST' && requestPath?.endsWith('/stop')) {
      stopRequests += 1;
      if (stopFailureStatus) return reply(res, stopFailureStatus, { error: 'stop failed' });
      if (hermesRunMissing) return reply(res, 404, { error: 'run not found' });
      /* Hermes acknowledges `stopping` while its run status settles to the
         terminal cancellation that carries measured usage. */
      hermesStatus = 'cancelled';
      return reply(res, 200, { status: 'stopping' });
    }
    if (requestPath?.startsWith('/v1/runs/')) {
      if (hermesRunMissing) return reply(res, 404, { error: 'run not found' });
      return reply(res, 200, {
        run_id: requestPath.split('/').at(-1),
        status: hermesStatus,
        output: 'Who is Nikola Tesla? Answer in two sentences.',
        reasoning: hermesReasoning,
        usage: { input_tokens: 42, output_tokens: 12, total_tokens: 54 },
        tool_outputs: ['must never cross'],
      });
    }
    return reply(res, 404, {});
  });
  hermesOrigin = await listen(hermesServer);

  runnerServer = createRunner({
    businessBrowser: {
      ensure: async () => { ensureCalls += 1; if (ensureBarrier) await ensureBarrier; },
      isPaused: async () => browserPaused,
      status: async () => ({ enabled: true, paused: browserPaused }),
      command: async (body) => {
        browserCommands.push(body);
        if (browserBarrier) await browserBarrier;
        browserPaused = body.action !== 'release';
        return { paused: browserPaused };
      },
    },
    businessId: BUSINESS,
    runnerKey: RUNNER_KEY,
    hermesKey: HERMES_KEY,
    hermesOrigin,
    release: '2026.08.27-1',
    toolMode: 'full-tools',
    webSearchBackend: 'ddgs',
    capabilities: ['computer_use'],
    modelName: 'MiniMax-M3',
    deepModelName: 'deepseek-v4-flash',
    candidateModelNames: ['MiniMax-M2.7-highspeed'],
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
    capabilities: ['computer_use'],
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
  assert.equal(body.hermes.jenteraPatch, 'jentera-runtime-2026-09-07');
  assert.equal(body.hermes.pid, 321);
  assert.match(body.runner.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(body.runner.sourceAttested, true);
  assert.equal(typeof body.runner.pid, 'number');
  assert.match(body.runner.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.webSearchBackend, 'ddgs');
  assert.deepEqual(body.capabilities, ['computer_use']);
  assert.deepEqual(body.specialistProfiles, {
    operations: true,
    customers: true,
    growth: true,
    records: true,
  });
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

test('readiness rejects a healthy orphan that did not load the Jentera Hermes patch', async () => {
  hermesPatch = undefined;
  const response = await call('/readyz');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.hermes.jenteraPatch, undefined);
});

test('refuses to attest an unapproved capability', () => {
  assert.throws(
    () =>
      createRunner({
        businessId: BUSINESS,
        runnerKey: RUNNER_KEY,
        hermesKey: HERMES_KEY,
        hermesOrigin: 'http://127.0.0.1:8642',
        release: '2026.08.27-1',
        toolMode: 'full-tools',
        webSearchBackend: 'ddgs',
        capabilities: ['teleport'],
        modelName: 'MiniMax-M3',
        deepModelName: 'deepseek-v4-flash',
        stateFile: join(directory, 'state.json'),
      }),
    /unknown runtime capability/,
  );
});

test('capabilities derive from the bootstrap-owned env contract', () => {
  const base = { AISAR_BUSINESS_ID: BUSINESS, AISAR_RUNNER_KEY: RUNNER_KEY, AISAR_TOOL_MODE: 'full-tools' };
  assert.deepEqual(configFromEnv({ ...base }).capabilities, []);
  assert.deepEqual(configFromEnv({ ...base, AISAR_CUA_ENABLED: '1' }).capabilities, ['computer_use']);
  // Any value other than exactly "1" fails closed.
  assert.deepEqual(configFromEnv({ ...base, AISAR_CUA_ENABLED: 'true' }).capabilities, []);
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
    model: 'deepseek-v4-flash',
    model_options: {
      reasoning: { enabled: true, effort: 'high' },
    },
  });
});

test('routes a specialist task through its isolated Hermes profile for its whole lifecycle', async () => {
  const response = await start(TASK, { profile: 'operations' });
  assert.equal(response.status, 202);
  assert.ok(hermesPaths.includes('/p/operations/v1/runs'));

  await call(`/v1/tasks/${TASK}`);
  assert.ok(hermesPaths.includes('/p/operations/v1/runs/run-1'));

  await call(`/v1/tasks/${TASK}/stop`, { method: 'POST' });
  assert.ok(hermesPaths.includes('/p/operations/v1/runs/run-1/stop'));

  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(state.tasks[TASK].profile, 'operations');
});

test('refuses a caller-defined Hermes profile', async () => {
  const response = await start(TASK, { profile: '../other-business' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /profile/);
  assert.equal(starts.length, 0);
});

test('persists a starting admission record before asking Hermes to spawn', async () => {
  let releaseStart;
  startBarrier = new Promise((resolve) => { releaseStart = resolve; });
  const starting = start(TASK);
  await waitFor(() => starts.length === 1);

  const admitted = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(admitted.tasks[TASK].status, 'starting');
  assert.equal(admitted.tasks[TASK].hermesRunId, null);
  assert.equal(typeof admitted.tasks[TASK].startedAt, 'number');

  releaseStart();
  assert.equal((await starting).status, 202);
  const persisted = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(persisted.tasks[TASK].hermesRunId, 'run-1');
});

test('memory deletion cannot overlap admission before the task is persisted', async () => {
  let release;
  ensureBarrier = new Promise((resolve) => { release = resolve; });
  const starting = start(TASK);
  await waitFor(() => ensureCalls === 1);
  try {
    const response = await call('/v1/memory/forget', { method: 'POST',
      body: JSON.stringify({ profile: 'default', file: 'USER.md', text: 'A note' }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'runtime_busy');
  } finally { release(); }
  assert.equal((await starting).status, 202);
});

test('disables reasoning for quick business conversation', async () => {
  const response = await start(TASK, { responseMode: 'quick' });
  assert.equal(response.status, 202);
  assert.deepEqual(starts[0].model_options, {
    reasoning: { enabled: false },
  });
  assert.equal(starts[0].model, 'MiniMax-M3');
});

test('refuses an unknown response mode', async () => {
  const response = await start(TASK, { responseMode: 'turbo' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /responseMode/);
  assert.equal(starts.length, 0);
});

test('refuses a model outside the configured quick and deep routes', async () => {
  const response = await start(TASK, { model: 'unreviewed-model' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /model/);
  assert.equal(starts.length, 0);
});

test('accepts a candidate model route beside quick and deep', async () => {
  const response = await start(TASK, { model: 'MiniMax-M2.7-highspeed', responseMode: 'quick' });
  assert.equal(response.status, 202);
  assert.equal(starts[0].model, 'MiniMax-M2.7-highspeed');
});

test('reads candidate model routes from the runtime environment', () => {
  const config = configFromEnv({
    AISAR_MODEL_NAME: 'MiniMax-M3',
    AISAR_DEEP_MODEL_NAME: 'deepseek-v4-flash',
    AISAR_CANDIDATE_MODEL_NAMES: ' MiniMax-M2.7-highspeed, vendor/other ',
  });
  assert.deepEqual(config.candidateModelNames, ['MiniMax-M2.7-highspeed', 'vendor/other']);
  assert.deepEqual(configFromEnv({}).candidateModelNames, []);
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
  assert.equal(stopRequests, 1);

  const terminal = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.equal(terminal.status, 'cancelled');
  assert.deepEqual(terminal.usage, { input_tokens: 42, output_tokens: 12, total_tokens: 54 });
});

test('reports a failed stop as failure and leaves the task retryable', async () => {
  await start(TASK);
  stopFailureStatus = 500;

  const stopped = await call(`/v1/tasks/${TASK}/stop`, { method: 'POST' });
  assert.equal(stopped.status, 502);
  assert.equal((await stopped.json()).ok, false);
  assert.equal(stopRequests, 1);

  stopFailureStatus = 0;
  const retried = await call(`/v1/tasks/${TASK}/stop`, { method: 'POST' });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).status, 'stopping');
  assert.equal(stopRequests, 2);
});

test('terminal status carries bounded output, usage, and reasoning — nothing else', async () => {
  await start(TASK);
  hermesStatus = 'completed';
  const status = await call(`/v1/tasks/${TASK}`);
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(body.status, 'completed');
  assert.equal(body.output, 'Who is Nikola Tesla? Answer in two sentences.');
  assert.deepEqual(body.usage, { input_tokens: 42, output_tokens: 12, total_tokens: 54 });
  assert.equal(
    body.reasoning,
    'The user asks a biographical question.\nKeep the answer focused and factual.',
  );
  /* Tool outputs and any other Hermes internals never cross the allowlist. */
  assert.equal('tool_outputs' in body, false);
});

test('serves the bounded terminal snapshot after Hermes reaps the run record', async () => {
  await start(TASK);
  hermesStatus = 'completed';
  const observed = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.equal(observed.status, 'completed');

  hermesRunMissing = true;
  const recoveredResponse = await call(`/v1/tasks/${TASK}`);
  assert.equal(recoveredResponse.status, 200);
  const recovered = await recoveredResponse.json();
  assert.deepEqual(recovered, observed);
  assert.equal('tool_outputs' in recovered, false);

  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(state.tasks[TASK].status, 'completed');
  assert.equal(state.tasks[TASK].terminal.output, observed.output);
  assert.equal(state.tasks[TASK].terminal.reasoning, observed.reasoning);
  assert.equal('tool_outputs' in state.tasks[TASK].terminal, false);
});

test('bounds reasoning like output', async () => {
  await start(TASK);
  hermesStatus = 'completed';
  hermesReasoning = 'step '.repeat(20_000);
  const body = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.equal(body.reasoning.length, 48_000);
});

test('streams Hermes-visible assistant, tool, and bounded thinking events without private internals', async () => {
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
  /* The bounded reasoning lane crosses on purpose: Hermes caps each slice at
     500 chars and the runner sanitises/redacts it, so the model's live CoT can
     render in the ephemeral bubble. Inline think blocks in message deltas,
     terminal transcripts, and run outputs still never cross. */
  assert.match(stream, /"type":"thinking"/);
  assert.match(stream, /"text":"private chain of thought"/);
  assert.match(stream, /"type":"iteration"/);
  assert.match(stream, /"current":12,"total":20/);
  assert.doesNotMatch(
    stream,
    /terminal transcript|inline private reasoning| thinking/,
  );
  assert.match(stream, /"type":"done"/);

  const state = await readFile(join(directory, 'state.json'), 'utf8');
  assert.doesNotMatch(
    state,
    /Hello|Hermes|execute_code|urllib|chain of thought|terminal transcript|inline private reasoning|Safe answer/,
  );
});

test('relays only the bounded approval prompt and forwards an approved FIFO head', async () => {
  const requestId = 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa';
  hermesEventsList = [{
    event: 'approval.request',
    run_id: 'run-1',
    timestamp: 1_788_000_000,
    request_id: requestId,
    command: 'curl -H "Authorization: Bearer secret-token" https://private.example',
    pattern_key: 'shell_network',
    pattern_keys: ['shell_network'],
    description: 'Allow execute_code to fetch the requested public source?',
    allow_permanent: true,
    allow_session: true,
    choices: ['once', 'session', 'always', 'deny'],
  }];
  await start(TASK);
  const stream = await (await call(`/v1/tasks/${TASK}/events`, {
    headers: { Accept: 'text/event-stream' },
  })).text();
  assert.match(stream, new RegExp(`"requestId":"${requestId}"`));
  assert.match(stream, /"type":"approval"/);
  assert.match(stream, /"tool":"execute_code"/);
  assert.match(stream, /fetch the requested public source/);
  assert.doesNotMatch(stream, /curl|shell_network|secret-token|pattern_keys|choices/);

  const approved = await call(`/v1/tasks/${TASK}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, decision: 'approve' }),
  });
  assert.equal(approved.status, 200);
  assert.deepEqual(approvalRequests, [{ choice: 'once', request_id: requestId }]);
  assert.equal((await approved.json()).status, 'running');

  const duplicate = await call(`/v1/tasks/${TASK}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, decision: 'approve' }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.deepEqual(approvalRequests, [{ choice: 'once', request_id: requestId }]);
});

test('rejects a forged approval id and forwards deny identity plus reason', async () => {
  const requestId = 'bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb';
  hermesEventsList = [{
    event: 'approval.request',
    request_id: requestId,
    description: 'Allow the requested tool?',
    tool: 'browser_open',
  }];
  await start(TASK);
  await (await call(`/v1/tasks/${TASK}/events`)).text();

  const forged = await call(`/v1/tasks/${TASK}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'cccccccccccc4ccc8ccccccccccccccc',
      decision: 'approve',
    }),
  });
  assert.equal(forged.status, 409);
  assert.deepEqual(approvalRequests, []);

  const denied = await call(`/v1/tasks/${TASK}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, decision: 'deny', reason: 'Owner declined this destination.' }),
  });
  assert.equal(denied.status, 200);
  assert.deepEqual(approvalRequests, [{
    choice: 'deny',
    request_id: requestId,
    reason: 'Owner declined this destination.',
  }]);
});

test('quarantines a run Hermes no longer knows so a new task can start', async () => {
  await start(TASK);
  assert.equal((await start(TASK_2)).status, 409);

  /* Hermes restarts and loses the in-flight run — exactly the production
     wedge. The next admission check must quarantine it instead of staying
     busy forever. */
  hermesRunMissing = true;
  assert.equal((await start(TASK_2)).status, 202);
  assert.equal(starts.length, 2);

  const status = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.equal(status.status, 'failed');
  assert.match(status.error, /vanished/);

  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(state.tasks[TASK].status, 'failed');
  assert.equal(state.tasks[TASK].terminal.error, 'run vanished (Hermes returned not_found)');
  assert.equal(stopRequests, 1);
});

test('a 409 surfaces the active task startedAt and an aged task is quarantined', async () => {
  await start(TASK, { responseMode: 'quick' });
  const busy = await start(TASK_2);
  assert.equal(busy.status, 409);
  const busyBody = await busy.json();
  assert.equal(busyBody.error, 'runtime_busy');
  assert.equal(busyBody.activeTaskId, TASK);
  assert.equal(typeof busyBody.activeTaskStartedAt, 'number');
  assert.ok(busyBody.activeTaskStartedAt <= Date.now());

  /* L2: a slot held beyond its age bound is quarantined even though Hermes
     still reports the run running. */
  const stateFile = join(directory, 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.tasks[TASK].startedAt = Date.now() - 20 * 60 * 1000; /* quick bound: 15m */
  await writeFile(stateFile, JSON.stringify(state));

  assert.equal((await start(TASK_2)).status, 202);
  const status = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.equal(status.status, 'failed');
  assert.match(status.error, /age limit/);
  assert.equal(stopRequests, 1);
});

test('a quarantine stop failure keeps the slot held and remains stoppable', async () => {
  await start(TASK, { responseMode: 'quick' });
  const stateFile = join(directory, 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.tasks[TASK].startedAt = Date.now() - 20 * 60 * 1000;
  await writeFile(stateFile, JSON.stringify(state));
  stopFailureStatus = 500;

  assert.equal((await start(TASK_2)).status, 409);
  const pending = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(pending.tasks[TASK].status, 'quarantined');
  assert.match(pending.tasks[TASK].stopError, /500/);

  stopFailureStatus = 0;
  assert.equal((await start(TASK_2)).status, 202);
  assert.ok(stopRequests >= 2);
});

test('enforces deadlineAt, stops Hermes, and preserves post-stop usage as expired', async () => {
  const deadlineAt = Date.now() + 100;
  const response = await start(TASK, { deadlineAt });
  assert.equal(response.status, 202);

  await waitFor(async () => {
    const status = await (await call(`/v1/tasks/${TASK}`)).json();
    return status.status === 'expired';
  });
  const expired = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.equal(expired.status, 'expired');
  assert.match(expired.error, /deadline/);
  assert.deepEqual(expired.usage, { input_tokens: 42, output_tokens: 12, total_tokens: 54 });
  assert.ok(stopRequests >= 1);

  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(state.tasks[TASK].deadlineAt, deadlineAt);
  assert.equal(state.tasks[TASK].terminal.status, 'expired');
});

test('a deadline during admission waits for the Hermes run identity before releasing', async () => {
  let releaseStart;
  startBarrier = new Promise((resolve) => { releaseStart = resolve; });
  const starting = start(TASK, { deadlineAt: Date.now() + 100 });
  await waitFor(() => starts.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 120));

  const pending = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(pending.tasks[TASK].status, 'expiring');
  assert.equal(pending.tasks[TASK].hermesRunId, null);
  assert.equal(stopRequests, 0);

  releaseStart();
  assert.equal((await starting).status, 202);
  await waitFor(async () => {
    const status = await (await call(`/v1/tasks/${TASK}`)).json();
    return status.status === 'expired';
  });
  assert.ok(stopRequests >= 1);
});

test('a run completed before its deadline is preserved without a stop', async () => {
  await start(TASK, { deadlineAt: Date.now() + 100 });
  hermesStatus = 'completed';
  await new Promise((resolve) => setTimeout(resolve, 120));

  const completed = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.usage, { input_tokens: 42, output_tokens: 12, total_tokens: 54 });
  assert.equal(stopRequests, 0);
});

test('rejects malformed, elapsed, and overlong deadlines before admission', async () => {
  for (const deadlineAt of [
    'soon',
    Date.now() - 1,
    Date.now() + 60 * 60 * 1000 + 5_000,
  ]) {
    const response = await start(TASK, { deadlineAt });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /deadlineAt/);
  }
  assert.equal(starts.length, 0);
});

test('readyz reconciles the slot and reports the active task', async () => {
  await start(TASK, { responseMode: 'quick' });
  const ready = await (await call('/readyz')).json();
  /* No runner source attestation in the test config, so readiness is 503 —
     but the runner still reconciles and reports the slot. */
  assert.equal(ready.activeTask.taskId, TASK);
  assert.equal(ready.activeTask.status, 'running');
  assert.equal(typeof ready.activeTask.startedAt, 'number');
  assert.equal(typeof ready.activeTask.ageSeconds, 'number');
  assert.equal(ready.activeTask.mode, 'quick');

  hermesRunMissing = true;
  const after = await (await call('/readyz')).json();
  assert.equal(after.activeTask, null);
});

test('stop on an orphaned run quarantines instead of failing forever', async () => {
  await start(TASK);
  hermesRunMissing = true;

  const stopped = await call(`/v1/tasks/${TASK}/stop`, { method: 'POST' });
  assert.equal(stopped.status, 200);
  const body = await stopped.json();
  assert.equal(body.status, 'failed');
  assert.match(body.error, /vanished/);

  /* The slot is free again — a fresh task is admitted right away. */
  assert.equal((await start(TASK_2)).status, 202);

  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(state.tasks[TASK].status, 'failed');
  assert.equal(state.tasks[TASK].terminal.error, 'run vanished (Hermes returned not_found)');
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

test('browser control authenticates, checks business and excludes agent admission', async () => {
  const command = (businessId = BUSINESS, action = 'claim') => call('/v1/browser', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId, action }),
  });
  assert.equal((await fetch(`${runnerOrigin}/v1/browser`)).status, 401);
  assert.equal((await command(TASK)).status, 403);
  let unlock;
  browserBarrier = new Promise((resolve) => { unlock = resolve; });
  const claiming = command();
  await waitFor(() => browserCommands.length === 1);
  assert.equal((await start(TASK)).status, 409);
  unlock();
  assert.equal((await claiming).status, 200);
  assert.equal((await start(TASK)).status, 409);
  assert.equal(starts.length, 0);
  assert.equal((await command(BUSINESS, 'release')).status, 200);
  assert.equal((await start(TASK)).status, 202);
  assert.equal((await command()).status, 409);
  assert.equal(browserCommands.length, 2);
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

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition was not met before timeout');
}

test('hands the files the agent saved for the owner to the worker before the task reads complete', async () => {
  const uploads = [];
  const workerServer = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/runtime/artifacts') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      uploads.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      return reply(res, 201, { ok: true, artifact: { id: `art-${uploads.length}`, name: req.headers['x-aisar-artifact-name'] } });
    }
    return reply(res, 404, { ok: false });
  });
  const workerOrigin = await listen(workerServer);
  const outputsRoot = join(directory, 'outputs');
  const server = createRunner({
    businessBrowser: {
      ensure: async () => {}, isPaused: async () => false,
      status: async () => ({ enabled: false, paused: false }), command: async () => ({ paused: false }),
    },
    businessId: BUSINESS, runnerKey: RUNNER_KEY, hermesKey: HERMES_KEY, hermesOrigin,
    release: '2026.08.27-1', toolMode: 'full-tools', webSearchBackend: 'ddgs', capabilities: [],
    modelName: 'MiniMax-M3', deepModelName: 'deepseek-v4-flash', candidateModelNames: [],
    stateFile: join(directory, 'state-outputs.json'),
    outputsRoot,
    configUrl: `${workerOrigin}/v1/runtime/config`,
    configKey: 'sk-jentera-v1.test.key',
  });
  const origin = await listen(server);
  const headers = { 'X-Aisar-Runner-Key': RUNNER_KEY };
  try {
    const started = await fetch(`${origin}/v1/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: BUSINESS, taskId: TASK, leaseToken: 'lease-token-long-enough',
        input: 'Write the digest as a file', sessionId: 'business-thread',
        instructions: 'Propose actions; do not send them directly.', toolGrant: grant(TASK),
      }),
    });
    assert.equal(started.status, 202);
    /* Hermes was told where a file for the owner goes, after the run's own instructions. */
    const dir = join(outputsRoot, TASK);
    assert.match(starts.at(-1).instructions, /^Propose actions; do not send them directly\.\n\nFiles for the owner:/);
    assert.ok(starts.at(-1).instructions.includes(dir));

    /* The agent saved a deliverable and a scratch file; Hermes then finished. */
    await writeFile(join(dir, 'tech-digest.md'), '# Digest');
    await writeFile(join(dir, '.scratch'), 'no');
    hermesStatus = 'completed';
    const body = await (await fetch(`${origin}/v1/tasks/${TASK}`, { headers })).json();
    assert.equal(body.status, 'completed');
    assert.deepEqual(body.artifacts, [{ name: 'tech-digest.md', size: 8, contentType: 'text/markdown' }]);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].headers.authorization, 'Bearer sk-jentera-v1.test.key');
    assert.equal(uploads[0].headers['x-aisar-task-id'], TASK);
    assert.equal(uploads[0].headers['x-aisar-artifact-name'], 'tech-digest.md');
    assert.equal(uploads[0].headers['content-type'], 'text/markdown');
    assert.equal(uploads[0].body, '# Digest');
    /* The folder is cleared, and the frozen snapshot never uploads twice. */
    await assert.rejects(access(dir));
    const again = await (await fetch(`${origin}/v1/tasks/${TASK}`, { headers })).json();
    assert.equal(again.status, 'completed');
    assert.deepEqual(again.artifacts, body.artifacts);
    assert.equal(uploads.length, 1);
  } finally {
    await close(server);
    await close(workerServer);
  }
});
