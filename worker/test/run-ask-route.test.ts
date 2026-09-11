import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimRuntime, markRuntimeReady } from '../src/agent-runtime';
import type { Env } from '../src/env';
import { handleRuns } from '../src/routes/runs';
import { CREDIT_CAP_NOTICE } from '../src/runtime/consumer';
import { FAILURE_NOTICES } from '../src/runtime/failure-notice';
import { append, recordWork } from '../src/runs';
import { asOwner, asTenant, fetchFake, req, sendFake, signIn, testEnv, truncateAll } from './harness';
import { LocalRuntimeProvider } from '../src/runtime';
import { ensureProviderRuntime } from '../src/runtime/provision';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const RELEASE = '2026.08.28-4';
const MODEL = 'deepseek/deepseek-v4-flash-0731';
let cookieA: string;
let cookieB: string;

beforeEach(async () => {
  await truncateAll();
  let userA = '';
  let userB = '';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'retail')`;
    const [a] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    const [b] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('b@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${a.id}, ${A}, 'owner'), (${b.id}, ${B}, 'owner')`;
    userA = a.id;
    userB = b.id;
  });
  cookieA = await signIn(userA);
  cookieB = await signIn(userB);
});

describe('Ask Jentera runtime bridge', () => {
  it('keeps ordinary Ask on the inline answer path when mode is ask', async () => {
    const response = await call('POST', '/api/runs/ask', durableEnv(), cookieB, {
      question: 'What happened today?',
      requestId: crypto.randomUUID(),
      mode: 'ask',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      text: 'A drafted reply.',
      grounded: false,
    });
  });

  it('routes a mode-less Ask to durable Hermes work by default', async () => {
    await readyRuntime(A);
    const send = sendFake();
    const response = await call('POST', '/api/runs/ask', durableEnv(send), cookieA, {
      question: 'Give me the quick answer',
      requestId: crypto.randomUUID(),
    });

    expect(response.status).toBe(202);
    const body = await response.json() as { runId: string; pending: boolean };
    expect(body.pending).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('waits with 503 when a default work Ask has no ready runtime yet', async () => {
    const preparing = await call('POST', '/api/runs/ask', durableEnv(), cookieB, {
      question: 'Do this in the background',
      requestId: crypto.randomUUID(),
    });
    expect(preparing.status).toBe(503);
    expect(await preparing.json()).toEqual({
      ok: false,
      err: 'Jentera is preparing your agent. Please try again shortly.',
    });
  });

  it('rejects unknown execution modes', async () => {
    const invalid = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'Try an invented mode',
      requestId: crypto.randomUUID(),
      mode: 'turbo',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, err: 'ask mode is invalid' });

    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>` 
      select count(*)::text as count from runtime_task`);
    expect(count).toBe('0');
  });

  it('publishes one tenant-derived durable run without trusting a body business id', async () => {
    await readyRuntime(A);
    const send = sendFake();
    const response = await call('POST', '/api/runs/ask', durableEnv(send), cookieA, {
      question: 'What should I improve?',
      requestId: crypto.randomUUID(),
      mode: 'work',
      businessId: B,
      sessionId: 'chat-abc',
    });

    expect(response.status).toBe(202);
    const body = await response.json() as { runId: string; pending: boolean };
    expect(body.pending).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ version: 1, businessId: A });

    const [row] = await asOwner((sql) => sql<{
      business_id: string; runtime: string; model: string; kind: string; payload: Record<string, unknown>;
    }[]>`
      select r.business_id, r.runtime, r.model, t.kind, t.payload
        from run r join runtime_task t on t.run_id = r.id where r.id = ${body.runId}`);
    expect(row).toMatchObject({ business_id: A, runtime: 'hermes-sprite', model: MODEL, kind: 'run' });
    expect(row.payload).toMatchObject({
      sessionId: 'chat-abc',
      objective: 'What should I improve?',
      function: 'ask',
      channel: 'app',
      grounded: false,
    });
    expect(row.payload).not.toHaveProperty('businessId');
  });

  it('gives durable chat the same agent prompt and framing Telegram gets', async () => {
    await readyRuntime(A);
    const send = sendFake();
    const response = await call('POST', '/api/runs/ask', durableEnv(send), cookieA, {
      question: 'What should I improve?',
      requestId: crypto.randomUUID(),
      mode: 'work',
    });
    expect(response.status).toBe(202);
    const body = await response.json() as { runId: string };
    const [row] = await asOwner((sql) => sql<{ payload: { instructions: string; input: string } }[]>`
      select t.payload from runtime_task t where t.run_id = ${body.runId}`);
    /* prepareHermesAgent's shape: the agent persona with the date stamped
       on and the business context in the instructions; the message itself
       is the user turn, exactly as typed, as on Telegram. The same question
       must not read differently because it came from the app. */
    expect(row.payload.instructions).toMatch(/Current date \(UTC\): \d{4}-\d{2}-\d{2}\./);
    expect(row.payload.instructions).toContain('Confirmed information about this business:');
    expect(row.payload.instructions).toContain('Recent Jentera work:');
    expect(row.payload.input).toBe('What should I improve?');
  });

  it('routes clear work to this business’s persistent specialist profile', async () => {
    await readyRuntime(A);
    await asTenant(A, (tx) => tx`
      insert into specialist_profile
        (business_id, profile_key, name, description)
      values (${A}, 'customers', 'Customer communications',
              'Customer complaints, enquiries, replies and bookings')`);
    const response = await call('POST', '/api/runs/ask', durableEnv(vi.fn(async () => {})), cookieA, {
      question: 'Draft a reply to this customer complaint',
      requestId: crypto.randomUUID(),
      mode: 'work',
      sessionId: 'customer-thread',
    });
    expect(response.status).toBe(202);
    const body = await response.json() as { runId: string };
    const [row] = await asOwner((sql) => sql<{
      payload: { profile: string; instructions: string; sessionId: string };
    }[]>`select payload from runtime_task where run_id = ${body.runId}`);
    expect(row.payload.profile).toBe('customers');
    expect(row.payload.sessionId).toBe('customer-thread');
    expect(row.payload.instructions).toContain('Customer communications specialist profile');
    expect(row.payload.instructions).toContain('do not expose internal profile names');
  });

  it('reuses the same run for simultaneous-safe request retries', async () => {
    await readyRuntime(A);
    const send = sendFake();
    const env = durableEnv(send);
    const requestId = crypto.randomUUID();
    const [first, second] = await Promise.all([
      call('POST', '/api/runs/ask', env, cookieA, { question: 'Status?', requestId, mode: 'work' }),
      call('POST', '/api/runs/ask', env, cookieA, { question: 'Status?', requestId, mode: 'work' }),
    ]);
    const firstBody = await first.json() as { runId: string };
    const secondBody = await second.json() as { runId: string };

    expect(secondBody.runId).toBe(firstBody.runId);
    expect(send).toHaveBeenCalledTimes(2);
    const [{ runs, tasks }] = await asOwner((sql) => sql<{ runs: string; tasks: string }[]>`
      select count(distinct r.id)::text as runs, count(t.id)::text as tasks
        from run r join runtime_task t on t.run_id = r.id where r.business_id = ${A}`);
    expect({ runs, tasks }).toEqual({ runs: '1', tasks: '1' });
  });

  it('rejects invalid idempotency keys and a runtime that is not ready', async () => {
    const malformed = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'Hello', requestId: 'not-a-uuid', mode: 'work',
    });
    expect(malformed.status).toBe(400);

    const unavailable = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'Hello', requestId: crypto.randomUUID(), mode: 'work',
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      ok: false,
      err: 'Jentera is preparing your agent. Please try again shortly.',
    });
  });

  it('returns the completed Hermes answer only to the owning tenant', async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'Give me an update', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    await asOwner(async (sql) => {
      await sql`update runtime_task
                   set status = 'completed', result = ${sql.json({ text: 'Hermes answered safely.' })}
                 where run_id = ${runId}`;
      await sql`update run set status = 'completed', ended_at = now() where id = ${runId}`;
    });

    const own = await call('GET', `/api/runs/${runId}`, durableEnv(), cookieA);
    expect(await own.json()).toEqual({
      ok: true,
      runId,
      status: 'completed',
      pending: false,
      text: 'Hermes answered safely.',
      usedKeys: [],
      grounded: false,
      kind: 'conversation',
    });
    expect((await call('GET', `/api/runs/${runId}`, durableEnv(), cookieB)).status).toBe(404);
  });

  it('does not expose provider errors from failed durable runs', async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'Give me an update', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    await asOwner(async (sql) => {
      await sql`update runtime_task set status = 'failed', last_error = 'secret-token-leak'
                 where run_id = ${runId}`;
      await sql`update run set status = 'failed', ended_at = now() where id = ${runId}`;
    });

    const response = await call('GET', `/api/runs/${runId}`, durableEnv(), cookieA);
    expect(JSON.stringify(await response.json())).toBe(JSON.stringify({
      ok: true,
      runId,
      status: 'failed',
      pending: false,
      err: 'Jentera could not answer that just now. Please try again.',
    }));
  });

  it('tells the owner in the web chat when the run failed for the monthly cap', async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'yo bro', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    /* What the consumer writes when reserveRuntimeUsage refuses: the run
       fails and Activity gets the credit-cap notice as the outcome. */
    await asOwner(async (sql) => {
      await sql`update runtime_task set status = 'failed', last_error = 'runtime budget exceeded (input_tokens)'
                 where run_id = ${runId}`;
      await sql`update run set status = 'failed', ended_at = now() where id = ${runId}`;
      await sql`insert into work_record (business_id, run_id, objective, outcome, status, function, channel, risk)
                values (${A}, ${runId}, 'yo bro', ${CREDIT_CAP_NOTICE}, 'failed', 'ask', 'app', 'low')`;
    });
    const response = await call('GET', `/api/runs/${runId}`, durableEnv(), cookieA);
    expect(await response.json()).toMatchObject({ ok: true, status: 'failed', err: CREDIT_CAP_NOTICE });
    expect(CREDIT_CAP_NOTICE).toMatch(/US\$5/);
  });

  it("tells the owner in the web chat when the model provider hit its own limit", async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'yob', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    /* What the consumer writes for a router quota error: the raw text stays
       on the task, the work record carries the owner-facing notice. */
    await asOwner(async (sql) => {
      await sql`update runtime_task set status = 'failed' where run_id = ${runId}`;
      await sql`update run set status = 'failed', ended_at = now() where id = ${runId}`;
      await sql`insert into work_record (business_id, run_id, objective, outcome, status, function, channel, risk, kind)
                values (${A}, ${runId}, 'yob', ${FAILURE_NOTICES.provider_quota}, 'failed', 'ask', 'app', 'low', 'conversation')`;
    });
    const response = await call('GET', `/api/runs/${runId}`, durableEnv(), cookieA);
    expect(await response.json()).toMatchObject({ ok: true, status: 'failed', err: FAILURE_NOTICES.provider_quota });
    expect(FAILURE_NOTICES.provider_quota).not.toMatch(/litellm|HTTP/);
  });

  it('tells the chat and Activity whether a finished run was conversation or work', async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'are we open on sunday?', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    await asOwner(async (sql) => {
      await sql`update runtime_task set status = 'completed', result = ${'Yes.'} where run_id = ${runId}`;
      await sql`update run set status = 'completed', ended_at = now() where id = ${runId}`;
      await sql`insert into work_record (business_id, run_id, objective, outcome, status, function, channel, risk, kind)
                values (${A}, ${runId}, 'are we open on sunday?', 'Yes.', 'completed', 'ask', 'app', 'low', 'conversation')`;
    });
    const detail = await call('GET', `/api/runs/${runId}`, durableEnv(), cookieA);
    expect(await detail.json()).toMatchObject({ ok: true, status: 'completed', kind: 'conversation' });
    /* Activity is the list of things Jentera did: conversation stays off it
       and out of its counters, while a piece of work is listed with its kind. */
    await asOwner((sql) => sql`
      insert into work_record (business_id, objective, outcome, status, function, channel, risk, kind)
      values (${A}, 'Chase the late invoice', 'Sent reminder', 'completed', 'assistant', 'telegram', 'low', 'work')`);
    const activity = await call('GET', '/api/runs/activity', durableEnv(), cookieA);
    const body = await activity.json() as {
      work: Array<{ runId: string | null; objective: string; kind: string }>;
      counters: { handled: number };
    };
    expect(body.work.find((item) => item.runId === runId)).toBeUndefined();
    expect(body.work.map((item) => [item.objective, item.kind])).toEqual([['Chase the late invoice', 'work']]);
    expect(body.counters.handled).toBe(1);
  });

  it('returns a finished reply and a separate needs-input task status', async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'can u do wrangler login', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    await asTenant(A, async (tx) => {
      await tx`update runtime_task set status = 'completed', result = ${tx.json({ text: 'Please authorize in your browser.' })}
        where run_id = ${runId}`;
      await tx`update run set status = 'completed', ended_at = now() where id = ${runId}`;
      await append(tx, A, runId, 'outcome.observed', { assessmentVersion: 1, kind: 'work', status: 'needs_input' });
      await recordWork(tx, A, { runId, objective: 'Log in', kind: 'work', status: 'needs_input' });
    });
    expect(await (await call('GET', `/api/runs/${runId}`, durableEnv(), cookieA)).json())
      .toMatchObject({ pending: false, status: 'completed', kind: 'work', taskStatus: 'needs_input',
        text: 'Please authorize in your browser.' });
    expect((await call('GET', `/api/runs/${runId}`, durableEnv(), cookieB)).status).toBe(404);
  });

  it('proxies a WebSocket only after origin, session, and tenant checks', async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'Stream this', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    const streamFetch = fetchFake(async () => new Response(null, { status: 204 }));
    const idFromName = vi.fn(() => ({ toString: () => 'stream-id' }));
    const env = durableEnv();
    env.RUN_STREAMS = {
      idFromName,
      get: () => ({ fetch: streamFetch }),
    } as unknown as DurableObjectNamespace;

    const allowed = await streamCall(runId, env, cookieA, 'https://jentera.ai');
    expect(allowed.status).toBe(204);
    expect(idFromName).toHaveBeenCalledWith(`${A}:${runId}`);
    expect(streamFetch).toHaveBeenCalledOnce();
    expect(streamFetch.mock.calls[0][1]?.headers).toMatchObject({
      Upgrade: 'websocket',
      'X-Jentera-Business': A,
      'X-Jentera-Run': runId,
    });

    expect((await streamCall(runId, env, cookieA, 'https://evil.example')).status).toBe(403);
    expect((await streamCall(runId, env, cookieB, 'https://jentera.ai')).status).toBe(404);
    expect((await streamCall(runId, env, undefined, 'https://jentera.ai')).status).toBe(401);
    expect(streamFetch).toHaveBeenCalledOnce();
  });
});

async function readyRuntime(businessId: string): Promise<void> {
  const env = durableEnv();
  await asTenant(businessId, (tx) => claimRuntime(env, tx, businessId, {
    provider: 'fly-sprite',
    providerName: `test-${businessId.slice(0, 8)}`,
    release: RELEASE,
    runnerKey: 'runner-test-key',
    hermesApiKey: 'hermes-test-key',
  }));
  await asTenant(businessId, (tx) => markRuntimeReady(tx, businessId, RELEASE, 'v1'));
}

function durableEnv(send = sendFake()): Env {
  return testEnv({
    RUNTIME_RELEASE: RELEASE,
    RUNTIME_EXECUTION_ENABLED: 'true',
    AISAR_MODEL_NAME: MODEL,
    RUNTIME_QUEUE: { send },
  });
}

async function call(
  method: string,
  path: string,
  env: Env,
  cookie?: string,
  body?: unknown,
): Promise<Response> {
  const incoming = req(method, path, { cookie, body });
  const response = await handleRuns(incoming.request, env, incoming.url, {});
  if (!response) throw new Error('runs route did not match');
  return response;
}

async function streamCall(
  runId: string,
  env: Env,
  cookie: string | undefined,
  origin: string,
): Promise<Response> {
  const url = new URL(`https://api.test/api/runs/${runId}/events`);
  const request = new Request(url, {
    headers: {
      Origin: origin,
      Upgrade: 'websocket',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const response = await handleRuns(request, env, url, {
    'Access-Control-Allow-Origin': 'https://jentera.ai',
  });
  if (!response) throw new Error('run stream route did not match');
  return response;
}

describe('response mode from the web chat', () => {
  const modes = (send = sendFake()) => testEnv({
    RUNTIME_RELEASE: RELEASE,
    RUNTIME_EXECUTION_ENABLED: 'true',
    AISAR_MODEL_NAME: 'quick-model',
    AISAR_DEEP_MODEL_NAME: 'deep-model',
    RUNTIME_QUEUE: { send },
  });
  async function modelFor(body: Record<string, unknown>) {
    await readyRuntime(A);
    const response = await call('POST', '/api/runs/ask', modes(), cookieA, {
      requestId: crypto.randomUUID(), mode: 'work', ...body,
    });
    if (response.status !== 202) return { status: response.status };
    const { runId } = await response.json() as { runId: string };
    const [row] = await asOwner((sql) => sql<{ model: string; payload: { responseMode?: string } }[]>`
      select r.model, t.payload from run r join runtime_task t on t.run_id = r.id where r.id = ${runId}`);
    return { status: 202, model: row.model, responseMode: row.payload.responseMode };
  }

  /* Chat was hard-wired to deep, so every web message paid the research
     loop; Telegram defaults to quick. Same default on both since
     2026-09-10, with the same explicit escape hatches. */
  it('is quick by default', async () => {
    expect(await modelFor({ question: 'Are we open on Sunday?' })).toEqual({
      status: 202, model: 'quick-model', responseMode: 'quick',
    });
  });
  it('goes deep when the toggle asks for it', async () => {
    expect(await modelFor({ question: 'Compare our suppliers', responseMode: 'deep' })).toEqual({
      status: 202, model: 'deep-model', responseMode: 'deep',
    });
  });
  it('honours /deep typed into the message, like Telegram', async () => {
    expect(await modelFor({ question: '/deep compare our suppliers' })).toEqual({
      status: 202, model: 'deep-model', responseMode: 'deep',
    });
  });
  it('rejects an unknown response mode', async () => {
    expect((await modelFor({ question: 'hi', responseMode: 'fast' })).status).toBe(400);
  });
});

describe('the first slice of a web ask runs inline from the intake', () => {
  /* The queue consumer runs far from the database: every tenant transaction
     cost 1–2 s there and a "yob" waited 12–16 s before Hermes was even asked.
     The intake is placed next to the database and an HTTP invocation has no
     wall-time limit, so it now leases, dispatches and relays the first slice
     itself. The queue message is sent with a delay, as a safety net only. */
  it('starts and finishes a quick reply from the request, the queue only as a safety net', async () => {
    const provider = new LocalRuntimeProvider();
    const send = sendFake();
    const published: Array<Record<string, unknown>> = [];
    const env = testEnv({
      RUNTIME_RELEASE: RELEASE,
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: MODEL,
      RUNTIME_QUEUE: { send },
      RUN_STREAMS: {
        idFromName: () => ({ toString: () => 'stream-id' }),
        get: () => ({
          fetch: async (_url: string, init?: RequestInit) => {
            published.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return Response.json({ ok: true });
          },
        }),
      },
    });
    await ensureProviderRuntime(env, A, {
      provider, runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, RELEASE, 'v1'));
    const events = [
      { type: 'delta', seq: 1, delta: 'Yes, ' },
      { type: 'delta', seq: 2, delta: 'we are open on Sunday.' },
      { type: 'done' },
    ].map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
    const runnerFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return Response.json({
          ok: true, release: RELEASE,
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools', webSearchBackend: 'ddgs', edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return Response.json({ ok: true, hermesRunId: 'inline-run', status: 'running' }, { status: 202 });
      }
      if (url.endsWith('/events')) {
        return new Response(events, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.includes('/v1/tasks/')) {
        return Response.json({ ok: true, status: 'completed', output: 'Yes, we are open on Sunday.' });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    };
    const background: Promise<unknown>[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => { background.push(promise); });
    const incoming = req('POST', '/api/runs/ask', {
      cookie: cookieA,
      body: { question: 'Are we open on Sunday?', requestId: crypto.randomUUID() },
    });
    const response = await handleRuns(
      incoming.request, env, incoming.url, {},
      { waitUntil },
      { provider, fetch: runnerFetch },
    );
    expect(response?.status).toBe(202);
    const { runId } = await response!.json() as { runId: string };
    expect(background).toHaveLength(1);
    await Promise.all(background);

    const [run] = await asOwner((sql) => sql<{ status: string }[]>`
      select status from run where id = ${runId}`);
    expect(run.status).toBe('completed');
    expect(published.filter((event) => event.type === 'delta').map((event) => event.text).join(''))
      .toBe('Yes, we are open on Sunday.');
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      { version: 1, businessId: A, taskId: expect.any(String) },
      { delaySeconds: 30 },
    );
    /* The slice starts the moment the task is committed; the queue send and
       the stream publish happen while it already runs. */
    expect(waitUntil.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });
});
