import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimRuntime, markRuntimeReady } from '../src/agent-runtime';
import type { Env } from '../src/env';
import { handleRuns } from '../src/routes/runs';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';

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
    const send = vi.fn(async () => {});
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
    const send = vi.fn(async () => {});
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

  it('reuses the same run for simultaneous-safe request retries', async () => {
    await readyRuntime(A);
    const send = vi.fn(async () => {});
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

  it('proxies a WebSocket only after origin, session, and tenant checks', async () => {
    await readyRuntime(A);
    const started = await call('POST', '/api/runs/ask', durableEnv(), cookieA, {
      question: 'Stream this', requestId: crypto.randomUUID(), mode: 'work',
    });
    const { runId } = await started.json() as { runId: string };
    const streamFetch = vi.fn(async () => new Response(null, { status: 204 }));
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

function durableEnv(send = vi.fn(async () => {})): Env {
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
