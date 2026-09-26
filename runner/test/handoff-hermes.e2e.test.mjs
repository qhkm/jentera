import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRunner } from '../src/server.mjs';

const DEBUG_LOGS = process.env.HANDOFF_E2E_DEBUG === '1';

const HERMES = process.env.HANDOFF_E2E_HERMES;
const BUSINESS = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const RUNNER_KEY = 'r'.repeat(32);
const HERMES_KEY = 'e2e-hermes-key-0123456789abcdef0123456789abcdef';

/* Bootstrapped inside every real Hermes profile by `hermes profile create`
   (hermes_cli/profiles.py's _PROFILE_DIRS). Our harness writes profile files
   directly rather than running that command, so it recreates the same
   layout by hand — proven necessary against this pinned Hermes in Task 1's
   feasibility spike, which built an identical harness. */
const PROFILE_DIRS = ['memories', 'sessions', 'skills', 'skins', 'logs', 'plans', 'workspace', 'cron', 'home'];

test('Chief of Staff hands part of a task to records on the pinned Hermes', { skip: !HERMES, timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-e2e-'));
  const children = [];
  try {
    const modelPort = 18900 + Math.floor(Math.random() * 500);
    const hermesPort = 19500 + Math.floor(Math.random() * 500);
    children.push(spawn('python3', [new URL('./fixtures/scripted-model.py', import.meta.url).pathname, String(modelPort)], { stdio: 'ignore' }));
    const home = join(dir, 'home');
    for (const sub of PROFILE_DIRS) await mkdir(join(home, sub), { recursive: true });
    for (const sub of PROFILE_DIRS) await mkdir(join(home, 'profiles', 'records', sub), { recursive: true });
    const config = [
      'model:', '  default: mock/model', '  provider: openrouter', `  base_url: http://127.0.0.1:${modelPort}/v1`,
      '  api_key: ${OPENROUTER_API_KEY}', '  api_mode: chat_completions',
      'platform_toolsets:', '  api_server: [hermes-api-server, jentera]',
      'agent:', '  max_turns: 6', '  run_budget_seconds: 120', '  gateway_timeout: 120',
      'gateway:', '  multiplex_profiles: true', '  api_server:', '    max_concurrent_runs: 10', '',
    ].join('\n');
    await writeFile(join(home, 'config.yaml'), config);
    await writeFile(join(home, 'profiles', 'records', 'config.yaml'), config);
    /* Hermes's own has_usable_secret gate on a resolved provider key defaults
       to a 4-character minimum; a shorter dummy value would be treated as no
       key at all. Long enough to always clear that gate. */
    await writeFile(join(home, '.env'), `API_SERVER_ENABLED=true\nAPI_SERVER_KEY=${HERMES_KEY}\nOPENROUTER_API_KEY=e2e-dummy-key\nOPENROUTER_BASE_URL=http://127.0.0.1:${modelPort}/v1\n`, { mode: 0o600 });
    await writeFile(join(home, 'profiles', 'records', '.env'), `OPENROUTER_API_KEY=e2e-dummy-key\nOPENROUTER_BASE_URL=http://127.0.0.1:${modelPort}/v1\n`, { mode: 0o600 });
    await writeFile(join(home, 'profiles', 'records', 'SOUL.md'), '# Finance and records (e2e)\n');

    const runner = createRunner({
      businessBrowser: { ensure: async () => {}, isPaused: async () => false, status: async () => ({}), preview: async () => ({}), command: async () => ({}) },
      businessId: BUSINESS, runnerKey: RUNNER_KEY, hermesKey: HERMES_KEY,
      hermesOrigin: `http://127.0.0.1:${hermesPort}`, release: 'e2e', toolMode: 'full-tools', webSearchBackend: 'ddgs',
      capabilities: [], modelName: 'mock/model', deepModelName: 'mock/model', candidateModelNames: [],
      stateFile: join(dir, 'state.json'),
      configChannel: {
        state: () => ({}), profiles: () => ['records'], handoffEnabled: () => true,
        roster: () => [{ profile: 'records', name: 'Finance and records', description: 'Invoices.', instructions: '' }],
        loadLastKnownGood: async () => {}, refresh: async () => 'unchanged', applyPending: async () => false, backoffMs: () => 60_000,
      },
    });
    const runnerOrigin = await listen(runner);
    const gatewayLog = DEBUG_LOGS ? join(tmpdir(), 'handoff-e2e-gateway.log') : null;
    children.push(spawn(join(HERMES, '.venv', 'bin', 'hermes'), ['gateway', 'run', '--force'], {
      cwd: HERMES, stdio: gatewayLog ? ['ignore', openSync(gatewayLog, 'w'), openSync(gatewayLog, 'a')] : 'ignore',
      env: { ...process.env, HERMES_HOME: home, HERMES_KANBAN_DB: join(home, 'kanban.db'),
        API_SERVER_HOST: '127.0.0.1', API_SERVER_PORT: String(hermesPort),
        OPENROUTER_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, JENTERA_RUNNER_URL: runnerOrigin },
    }));
    await waitFor(async () => (await fetch(`http://127.0.0.1:${hermesPort}/health`).catch(() => null))?.ok, 60_000);

    const started = await fetch(`${runnerOrigin}/v1/tasks`, {
      method: 'POST',
      headers: { 'X-Aisar-Runner-Key': RUNNER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: BUSINESS, taskId: TASK, leaseToken: 'l'.repeat(32), input: 'COORDINATOR_TASK: check unpaid invoices',
        toolGrant: grant(TASK), handoff: { maxDepth: 2, maxHandoffs: 5, preamble: 'You are working on part of a task for a colleague.' } }),
    });
    assert.equal(started.status, 202);
    let status;
    await waitFor(async () => {
      status = await (await fetch(`${runnerOrigin}/v1/tasks/${TASK}`, { headers: { 'X-Aisar-Runner-Key': RUNNER_KEY } })).json();
      return ['completed', 'failed'].includes(status.status);
    }, 120_000);
    assert.equal(status.status, 'completed');
    assert.match(status.output, /COMBINED: .*SPECIALIST_RESULT: 3 unpaid invoices/);
    const stream = await (await fetch(`${runnerOrigin}/v1/tasks/${TASK}/events`, { headers: { 'X-Aisar-Runner-Key': RUNNER_KEY } })).text();
    /* Parsed rather than matched against the raw text: the object literal in
       src/handoff.mjs's `mark()` happens to serialize with `type`, `stage`
       and `specialist` in that order today, but a JSON-key-order assumption
       is brittle where a field-level check is not. */
    const events = stream.split(/\r?\n\r?\n/)
      .map((frame) => frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'))
      .filter(Boolean)
      .map((data) => { try { return JSON.parse(data); } catch { return null; } })
      .filter(Boolean);
    assert.ok(events.some((event) => event.type === 'handoff' && event.stage === 'finished' && event.specialist === 'records'),
      `no finished hand-off event for records in ${JSON.stringify(events)}`);
    assert.doesNotMatch(stream, /count unpaid invoices/);
    await close(runner);
  } finally {
    await Promise.all(children.map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill();
    })));
    /* A just-killed process can still hold the directory open for a moment
       (observed as ENOTEMPTY on the gateway's home dir); a couple of retries
       clears it without masking a real assertion failure above. */
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
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
