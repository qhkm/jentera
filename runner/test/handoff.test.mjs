import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HANDOFF_MAX_MS,
  HandoffEngine,
  addUsage,
  handoffBudgetMs,
  handoffFieldProblem,
  handoffRequestProblem,
} from '../src/handoff.mjs';

const ROSTER = [
  { profile: 'records', name: 'Finance and records', description: 'Invoices and cash flow.', instructions: '' },
  { profile: 'growth', name: 'Growth and marketing', description: 'Campaigns.', instructions: 'Keep it short.' },
  { profile: 'operations', name: 'Operations', description: 'Stock.', instructions: '' },
];
const LIMITS = { maxDepth: 2, maxHandoffs: 5, preamble: 'You are working on part of a task for a colleague.' };
const NOW = 1_000_000;

function sse(events) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
  }), { status: 200 });
}

/** A fake Hermes: each started run replays `script(profile, runId)` as its event stream. */
function fakeHermes(script) {
  const calls = [];
  let started = 0;
  return {
    calls,
    status: () => ({ status: 'completed', output: 'from status' }),
    async hermes(path, init = {}, profile) {
      calls.push({ path, method: init.method ?? 'GET', profile, body: init.body ? JSON.parse(init.body) : undefined });
      if (path === '/v1/runs' && init.method === 'POST') {
        started += 1;
        return Response.json({ run_id: `run_${profile}_${started}`, status: 'started' }, { status: 202 });
      }
      if (/^\/v1\/runs\/[^/]+$/.test(path)) return Response.json(this.status(path.split('/').at(-1)));
      return Response.json({ status: 'stopping' });
    },
    events: async (runId, profile) => sse(script(profile, runId)),
  };
}

function engine(script, overrides = {}) {
  const fake = fakeHermes(script);
  const emitted = [];
  const handoffs = new HandoffEngine({
    hermes: (...args) => fake.hermes(...args),
    events: (...args) => fake.events(...args),
    emit: (taskId, event, target) => emitted.push({ taskId, event, target }),
    translate: (event, profile) => event.event === 'tool.started'
      ? { type: 'tool.started', tool: event.tool, agent: profile } : null,
    roster: () => ROSTER,
    enabled: () => true,
    now: () => NOW,
    ...overrides,
  });
  handoffs.register('task-1', {
    rootRunId: 'run_root', deadlineAt: NOW + 900_000, model: 'deep-model', handoff: LIMITS,
  });
  return { handoffs, fake, emitted };
}

const done = (output, usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }) => [
  { event: 'tool.started', tool: 'business_records' },
  { event: 'run.completed', output, usage },
];
const ask = (specialist, brief = 'Which invoices are unpaid?', runId = 'run_root') => ({ runId, specialist, brief });

test('runs the specialist on its own profile and hands back its answer', async () => {
  const { handoffs, fake, emitted } = engine(() => done('3 invoices are unpaid.'));
  const result = await handoffs.request(ask('records'));
  assert.deepEqual(result, { ok: true, specialist: 'records', name: 'Finance and records', answer: '3 invoices are unpaid.' });
  const start = fake.calls.find((call) => call.path === '/v1/runs');
  assert.equal(start.profile, 'records');
  assert.equal(start.body.input, 'Which invoices are unpaid?');
  assert.equal(start.body.model, 'deep-model');
  assert.match(start.body.instructions, /^You are working on part of a task for a colleague\./);
  assert.match(start.body.instructions, /You are the Finance and records specialist\. Your remit: Invoices and cash flow\./);
  assert.deepEqual(emitted.map(({ event }) => event.type === 'handoff' ? event.stage : event.type),
    ['requested', 'started', 'tool.started', 'finished']);
  assert.deepEqual(emitted.find(({ event }) => event.type === 'tool.started'), {
    taskId: 'task-1',
    event: { type: 'tool.started', tool: 'business_records', agent: 'records' },
    target: { runId: 'run_records_1', profile: 'records' },
  });
  assert.deepEqual(handoffs.usageOf('task-1'), { input_tokens: 10, output_tokens: 5, total_tokens: 15 });
});

test('never puts the brief on the stream', async () => {
  const { handoffs, emitted } = engine(() => done('ok'));
  await handoffs.request(ask('records', 'password=hunter2 check the invoices'));
  assert.doesNotMatch(JSON.stringify(emitted), /hunter2|check the invoices/);
});

test('refuses a display name, an unknown caller and a switched-off business without starting a run', async () => {
  const { handoffs, fake } = engine(() => done('ok'));
  assert.equal((await handoffs.request(ask('Finance and records'))).code, 'unknown_specialist');
  assert.equal((await handoffs.request(ask('records', 'x', 'run_nobody'))).code, 'unavailable');
  const off = engine(() => done('ok'), { enabled: () => false });
  assert.equal((await off.handoffs.request(ask('records'))).code, 'unavailable');
  assert.equal(fake.calls.filter((call) => call.path === '/v1/runs').length, 0);
});

test('a task started without hand-off limits cannot hand off', async () => {
  const { handoffs, fake } = engine(() => done('ok'));
  handoffs.register('task-2', { rootRunId: 'run_quick', handoff: undefined });
  assert.equal((await handoffs.request(ask('records', 'x', 'run_quick'))).code, 'unavailable');
  assert.equal(fake.calls.length, 0);
});

test('lets a specialist ask one more, but not a third level, and never back up its chain', async () => {
  const seen = {};
  const { handoffs, fake } = engine(() => []);
  fake.events = async (runId, profile) => {
    if (profile === 'records') {
      seen.growth = await handoffs.request(ask('growth', 'Last month sales?', runId));
      seen.self = await handoffs.request(ask('records', 'Me again', runId));
    }
    if (profile === 'growth') {
      seen.deeper = await handoffs.request(ask('operations', 'Stock?', runId));
      seen.upstream = await handoffs.request(ask('records', 'Back to you', runId));
    }
    return sse([{ event: 'run.completed', output: `${profile} done`, usage: {} }]);
  };
  const top = await handoffs.request(ask('records', 'Reconcile last month'));
  assert.equal(top.ok, true);
  assert.equal(seen.growth.ok, true);
  assert.equal(seen.self.code, 'loop');
  assert.equal(seen.deeper.code, 'limit_depth');
  assert.equal(seen.upstream.code, 'loop');
});

test('refuses the sixth hand-off in a task', async () => {
  const { handoffs } = engine(() => done('ok'));
  for (let i = 0; i < 5; i += 1) assert.equal((await handoffs.request(ask('records', `#${i}`))).ok, true);
  assert.equal((await handoffs.request(ask('records', '#6'))).code, 'limit_count');
});

test('gives a hand-off only the time the caller can spare', async () => {
  assert.equal(handoffBudgetMs(NOW + 900_000, NOW), HANDOFF_MAX_MS);
  assert.equal(handoffBudgetMs(NOW + 70_000, NOW), 10_000);
  assert.equal(handoffBudgetMs(undefined, NOW), HANDOFF_MAX_MS);
  const { handoffs, fake } = engine(() => done('ok'));
  handoffs.register('task-3', { rootRunId: 'run_late', deadlineAt: NOW + 70_000, handoff: LIMITS });
  assert.equal((await handoffs.request(ask('records', 'x', 'run_late'))).code, 'time');
  assert.equal(fake.calls.filter((call) => call.path === '/v1/runs').length, 0);
});

test('stopping the task stops the specialist and answers its caller at once', async () => {
  const { handoffs, fake } = engine(() => []);
  fake.events = async (_runId, _profile, signal) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    },
  }), { status: 200 });
  const pending = handoffs.request(ask('records', 'A long job'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handoffs.stopTask('task-1');
  assert.equal((await pending).code, 'stopped');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_records_1/stop' && call.profile === 'records'));
  assert.equal((await handoffs.request(ask('records', 'Again'))).code, 'stopped');
});

test('a specialist out of credits is reported as that, not as a failure', async () => {
  const { handoffs } = engine(() => [{ event: 'run.failed', error: 'budget_exceeded: monthly model budget exhausted' }]);
  assert.equal((await handoffs.request(ask('records'))).code, 'budget');
});

test('asks Hermes directly when the event stream ends without a result', async () => {
  const { handoffs } = engine(() => [{ event: 'tool.started', tool: 'web_search' }]);
  assert.deepEqual(await handoffs.request(ask('records')),
    { ok: true, specialist: 'records', name: 'Finance and records', answer: 'from status' });
});

test('checks what a task start and a tool request may carry', () => {
  assert.equal(handoffFieldProblem(undefined), null);
  assert.equal(handoffFieldProblem(LIMITS), null);
  assert.match(handoffFieldProblem({ ...LIMITS, maxDepth: 3 }), /maxDepth/);
  assert.match(handoffFieldProblem({ ...LIMITS, preamble: '' }), /preamble/);
  assert.equal(handoffRequestProblem({ runId: 'run_1', specialist: 'records', brief: 'x' }), null);
  assert.match(handoffRequestProblem({ runId: 'run_1', specialist: 'records', brief: 'x'.repeat(2_001) }), /brief/);
  assert.match(handoffRequestProblem({ runId: '../etc', specialist: 'records', brief: 'x' }), /runId/);
  assert.deepEqual(addUsage({ input_tokens: 1 }, { input_tokens: 2, output_tokens: 3, bogus: 9 }),
    { input_tokens: 3, output_tokens: 3 });
});
