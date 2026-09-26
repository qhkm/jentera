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

/** A stream that never yields anything on its own; only an abort ends it. */
function hangingEvents(signal) {
  return new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    },
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
  assert.equal(off.fake.calls.filter((call) => call.path === '/v1/runs').length, 0);
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

test('stopping the task during a depth-2 hand-off stops both runs and resolves the root at once', async () => {
  const { handoffs, fake } = engine(() => []);
  fake.events = async (runId, profile, signal) => {
    if (profile === 'records') void handoffs.request(ask('growth', 'Last month sales?', runId));
    return hangingEvents(signal);
  };
  const pending = handoffs.request(ask('records', 'Reconcile'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handoffs.stopTask('task-1');
  assert.equal((await pending).code, 'stopped');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_records_1/stop' && call.profile === 'records'));
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_growth_2/stop' && call.profile === 'growth'));
});

test('stopping the task after a depth-2 hand-off finished still stops the depth-1 run alone', async () => {
  const { handoffs, fake } = engine(() => []);
  let growthPromise;
  fake.events = async (runId, profile, signal) => {
    if (profile === 'records') {
      growthPromise = handoffs.request(ask('growth', 'Last month sales?', runId));
      return hangingEvents(signal);
    }
    return sse([{ event: 'run.completed', output: 'growth done', usage: {} }]);
  };
  const pending = handoffs.request(ask('records', 'Reconcile'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await growthPromise).ok, true);
  await handoffs.stopTask('task-1');
  assert.equal((await pending).code, 'stopped');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_records_1/stop' && call.profile === 'records'));
  assert.equal(fake.calls.filter((call) => call.path === '/v1/runs/run_growth_2/stop').length, 0);
});

test("a caller's timeout cascades to a specialist still waiting on it, and a child's budget never exceeds its caller's remaining time", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const { handoffs, fake } = engine(() => []);
  handoffs.register('task-1', {
    rootRunId: 'run_root', deadlineAt: NOW + 160_000, model: 'deep-model', handoff: LIMITS,
  });
  fake.events = async (_runId, _profile, signal) => hangingEvents(signal);

  const pending = handoffs.request(ask('records', 'Reconcile'));
  await flush();
  await flush();

  /* records' own budget is 100_000ms (160_000 - the 60_000 reserve). Tick to
     just short of it, then ask growth from records' still-live run — its
     budget (handoffBudgetMs against records' deadline) comes to 40_000ms,
     confirming it never exceeds what records itself had left (10_000ms at
     this point), even though the number computed is larger: the number is a
     ceiling on how long growth may run, not a promise records will last that
     long itself. */
  t.mock.timers.tick(90_000);
  const growthPending = handoffs.request(ask('growth', 'Last month sales?', 'run_records_1'));
  await flush();
  await flush();
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs' && call.profile === 'growth'));

  /* Advance the remaining 10_000ms: records' own timer fires well before
     growth's own (40_000ms away), so any stop growth sees here can only be
     the cascade from records, not growth's own budget. */
  t.mock.timers.tick(10_000);
  await flush();
  await flush();

  const rootResult = await pending;
  assert.equal(rootResult.code, 'time');
  const growthResult = await growthPending;
  assert.equal(growthResult.code, 'time');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_records_1/stop' && call.profile === 'records'));
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_growth_2/stop' && call.profile === 'growth'));
});

test("a specialist's own budget is capped by what its caller has left, not the whole task's remaining time", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const { handoffs, fake } = engine(() => []);
  handoffs.register('task-1', {
    rootRunId: 'run_root', deadlineAt: NOW + 160_000, model: 'deep-model', handoff: LIMITS,
  });
  fake.events = async (runId, profile, signal) => {
    if (profile === 'records') void handoffs.request(ask('growth', 'Last month sales?', runId));
    return hangingEvents(signal);
  };
  const pending = handoffs.request(ask('records', 'Reconcile'));
  await flush();
  await flush();

  /* records' own budget (and so its deadline) is 100_000ms out (160_000 minus
     the 60_000 reserve); growth, asked immediately, gets what is left of
     THAT — 40_000ms — not the task's own remaining 100_000ms. Ticking only
     to 40_000 must already stop growth, well before records' own timer
     (60_000ms further out) would ever fire. */
  t.mock.timers.tick(40_000);
  await flush();
  await flush();

  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_growth_2/stop' && call.profile === 'growth'));
  assert.equal(fake.calls.filter((call) => call.path === '/v1/runs/run_records_1/stop').length, 0);
  await handoffs.stopTask('task-1');
  await pending;
});

test('usage from a failed specialist is still added to the task', async () => {
  const { handoffs } = engine(() => [
    { event: 'run.failed', error: 'oops', usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 } },
  ]);
  const result = await handoffs.request(ask('records'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'failed');
  assert.deepEqual(handoffs.usageOf('task-1'), { input_tokens: 7, output_tokens: 2, total_tokens: 9 });
});

test("a stopped specialist's usage is still recovered from the one status read follow() makes", async () => {
  const { handoffs, fake } = engine(() => []);
  fake.events = async (_runId, _profile, signal) => hangingEvents(signal);
  fake.status = () => ({ status: 'cancelled', usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } });
  const pending = handoffs.request(ask('records', 'A long job'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handoffs.stopTask('task-1');
  const result = await pending;
  assert.equal(result.code, 'stopped');
  assert.deepEqual(handoffs.usageOf('task-1'), { input_tokens: 3, output_tokens: 1, total_tokens: 4 });
});

test('only tool and approval events are relayed, always carrying which agent produced them', async () => {
  const script = () => [
    { event: 'tool.started', tool: 'business_records' },
    { event: 'assistant.delta', text: 'thinking...' },
    { event: 'run.completed', output: 'ok', usage: {} },
  ];
  const { handoffs, emitted } = engine(script, {
    translate: (event) => {
      if (event.event === 'tool.started') return { type: 'tool.started', tool: event.tool };
      if (event.event === 'assistant.delta') return { type: 'delta', delta: event.text };
      return null;
    },
  });
  await handoffs.request(ask('records'));
  const relayed = emitted.filter(({ event }) => event.type !== 'handoff');
  assert.deepEqual(relayed, [{
    taskId: 'task-1',
    event: { type: 'tool.started', tool: 'business_records', agent: 'records' },
    target: { runId: 'run_records_1', profile: 'records' },
  }]);
});

test("a rejected turn does not poison the caller's queue", async () => {
  let throwOnce = true;
  const { handoffs } = engine(() => done('ok'), {
    roster: () => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('roster unavailable');
      }
      return ROSTER;
    },
  });
  await assert.rejects(handoffs.request(ask('records', 'first')));
  const result = await handoffs.request(ask('records', 'second'));
  assert.equal(result.ok, true);
});

test('a stop that lands while the start POST is still in flight still stops that specialist', async () => {
  const { handoffs, fake } = engine(() => done('ok'));
  let releaseStart;
  const held = new Promise((resolve) => { releaseStart = resolve; });
  const realHermes = fake.hermes.bind(fake);
  fake.hermes = async (path, init, profile) => {
    if (path === '/v1/runs' && init?.method === 'POST' && profile === 'records') await held;
    return realHermes(path, init, profile);
  };

  const pending = handoffs.request(ask('records', 'Reconcile'));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await handoffs.stopTask('task-1');
  releaseStart();

  const result = await pending;
  assert.equal(result.code, 'stopped');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_records_1/stop' && call.profile === 'records'));
});

test("a caller's own timeout that lands while its specialist's start POST is still in flight still stops that specialist", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const { handoffs, fake } = engine(() => []);
  handoffs.register('task-1', {
    rootRunId: 'run_root', deadlineAt: NOW + 160_000, model: 'deep-model', handoff: LIMITS,
  });
  fake.events = async (runId, profile, signal) => {
    if (profile === 'records') void handoffs.request(ask('growth', 'Last month sales?', runId));
    return hangingEvents(signal);
  };
  let releaseGrowthStart;
  const held = new Promise((resolve) => { releaseGrowthStart = resolve; });
  const realHermes = fake.hermes.bind(fake);
  fake.hermes = async (path, init, profile) => {
    if (path === '/v1/runs' && init?.method === 'POST' && profile === 'growth') await held;
    return realHermes(path, init, profile);
  };

  const pending = handoffs.request(ask('records', 'Reconcile'));
  await flush();
  await flush();

  /* growth's start POST is now held mid-flight; fire records' own 100_000ms
     budget timer while it waits, then let it through. */
  t.mock.timers.tick(100_000);
  await flush();
  releaseGrowthStart();
  await flush();
  await flush();

  const result = await pending;
  assert.equal(result.code, 'time');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_growth_2/stop' && call.profile === 'growth'));
});

test('registering the next task stops a still-live specialist from the one before it', async () => {
  const { handoffs, fake } = engine(() => []);
  fake.events = async (_runId, _profile, signal) => hangingEvents(signal);
  const pending = handoffs.request(ask('records', 'A long job'));
  await new Promise((resolve) => setTimeout(resolve, 20));

  /* The next task is admitted before the previous one's specialist finished.
     Forgetting it must not leave that specialist running with nothing left
     able to stop it. */
  handoffs.register('task-2', {
    rootRunId: 'run_root_2', deadlineAt: NOW + 900_000, model: 'deep-model', handoff: LIMITS,
  });

  assert.equal((await pending).code, 'stopped');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_records_1/stop' && call.profile === 'records'));
  /* The forgotten task's usage is gone with it — nothing to add it to any more. */
  assert.equal(handoffs.usageOf('task-1'), null);
});
