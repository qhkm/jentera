import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markRuntimeReady } from '../src/agent-runtime';
import { runTrace, startRun } from '../src/runs';
import { handleRuntimeMessage, LocalRuntimeProvider } from '../src/runtime';
import { RunnerClient, RuntimeBusyError } from '../src/runtime/runner-client';
import { FAILURE_NOTICES } from '../src/runtime/failure-notice';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { reserveRuntimeUsage } from '../src/runtime/usage';
import type { RuntimeProvider } from '../src/runtime/provider';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';
import { saveConnection } from '../src/connections';

const A = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('durable Hermes run delivery', () => {
  it('ends a live observation slice before the consumer ceiling and persists its next wake', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.09.01-3',
      AISAR_MODEL_NAME: 'MiniMax-M3',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.09.01-3', 'v1'));
    const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('slice-owner@example.com', true) returning id`);
    const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '123456789',
      displayName: '@slice_bot',
      secret: '123456789:AAtoken',
      connectedBy: owner.id,
    }));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.message.telegram', runtime: 'hermes-sprite',
      model: 'MiniMax-M3',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      runId: run.id,
      dedupeKey: `slice:${run.id}`,
      payload: {
        input: 'Long research task',
        model: 'MiniMax-M3',
        telegram: {
          connectionId: connection.id,
          chatId: 42,
          messageId: 7,
          from: 'Owner',
          question: 'Long research task',
          privateChat: true,
          liveMessageId: 77,
        },
      },
    }));
    vi.stubGlobal('fetch', vi.fn(async () =>
      response({ ok: true, result: { message_id: 77 } })));
    const runnerFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true,
          release: '2026.09.01-3',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'slice-hermes-run', status: 'running' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        const signal = init?.signal;
        return new Response(new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return response({ error: 'not found' }, 404);
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: runnerFetch, observationSliceMs: 30 },
    )).resolves.toEqual({
      action: 'requeue', delaySeconds: 2, reason: 'bounded observation slice completed',
    });
    const [state] = await asOwner((sql) => sql<{
      status: string; remote_run_id: string; dispatch_phase: string; wakes: string;
    }[]>`
      select t.status, t.remote_run_id, t.dispatch_phase,
             count(o.id) filter (where o.sent_at is null)::text as wakes
        from runtime_task t
        left join runtime_task_outbox o on o.task_id = t.id
       where t.id = ${task.id}
       group by t.id`);
    expect(state).toEqual({
      status: 'queued',
      remote_run_id: 'slice-hermes-run',
      dispatch_phase: 'remotely_running',
      wakes: '1',
    });
  });

  it('uses attested readiness as the single Sprite wake probe', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.09.01-3',
      AISAR_MODEL_NAME: 'MiniMax-M3',
      SPRITES_TOKEN: 'sprite-edge-token',
    });
    const local = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider: local,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.09.01-3', 'v1'));
    await asOwner((sql) => sql`
      update agent_runtime
         set provider = 'fly-sprite', provider_id = 'sprite-1',
             provider_url = 'https://sprite.test'
       where business_id = ${A}`);
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'MiniMax-M3',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    const wake = vi.fn(async () => { throw new Error('redundant wake probe'); });
    const provider = { id: 'fly-sprite', wake } as unknown as RuntimeProvider;
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true,
          release: '2026.09.01-3',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'run-hermes-fast', status: 'started' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        /* Every run is observed live now (the web chat streams from it); a
           runner that finishes at once ends its stream with done. */
        return new Response('data: {"type":"done"}\n\n', {
          status: 200, headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (url.endsWith(`/v1/tasks/${task.id}`)) {
        return response({ ok: true, status: 'completed', output: 'Done.' });
      }
      return response({ error: 'not found' }, 404);
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: fetcher },
    )).resolves.toEqual({ action: 'ack', reason: 'completed' });
    expect(wake).not.toHaveBeenCalled();
    expect(urls.filter((url) => url.endsWith('/readyz'))).toHaveLength(1);
    expect(urls.some((url) => url.endsWith('/healthz'))).toBe(false);
  });

  it('starts once, defers polling, then completes the Jentera history atomically', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask',
      triggerShape: 'owner.ask',
      runtime: 'hermes-sprite',
      model: 'deepseek/deepseek-v4-flash-0731',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      runId: run.id,
      dedupeKey: `run:${run.id}`,
      payload: {
        input: 'Summarise the confirmed business facts.',
        instructions: 'Do not use tools.',
        objective: 'Summarise the business',
        function: 'ask',
        channel: 'app',
      },
    }));
    await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, env.AISAR_MODEL_NAME!));
    await asOwner((sql) => sql`
      update runtime_usage set started_at = now() - interval '5 minutes'
       where runtime_task_id = ${task.id}`);

    let remoteStatus = 'running';
    const seen: { url: string; authorization: string | null; runnerKey: string | null }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        authorization: headers.get('Authorization'),
        runnerKey: headers.get('X-Aisar-Runner-Key'),
      });
      if (url.endsWith('/readyz')) {
        return response({
          ok: true,
          release: '2026.08.27-1',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'run-hermes-1', status: 'started' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        return new Response('data: {"type":"done"}\n\n', {
          status: 200, headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (url.endsWith(`/v1/tasks/${task.id}`)) {
        return response({
          ok: true,
          status: remoteStatus,
          output: remoteStatus === 'completed' ? 'The business is ready.' : undefined,
          usage: remoteStatus === 'completed'
            ? { input_tokens: 18_000, output_tokens: 20, total_tokens: 18_020 }
            : undefined,
        });
      }
      return response({ error: 'not found' }, 404);
    };

    const message = { version: 1 as const, businessId: A, taskId: task.id };
    await expect(handleRuntimeMessage(env, message, { provider, fetch: fetcher }))
      .resolves.toEqual({
        action: 'requeue', delaySeconds: 5, reason: 'Hermes run is still active',
      });
    const [pending] = await asOwner((sql) => sql<{
      status: string; remote_run_id: string; remote_status: string;
    }[]>`select status, remote_run_id, remote_status from runtime_task where id = ${task.id}`);
    expect(pending).toEqual({
      status: 'queued', remote_run_id: 'run-hermes-1', remote_status: 'running',
    });
    const [firstPoll] = await asOwner((sql) => sql<{ attempt: number }[]>`
      select attempt from runtime_task where id = ${task.id}`);
    expect(firstPoll.attempt).toBe(0);
    const [startedUsage] = await asOwner((sql) => sql<{ started_at: Date }[]>`
      select started_at from runtime_usage where runtime_task_id = ${task.id}`);
    expect(Date.now() - startedUsage.started_at.getTime()).toBeLessThan(5_000);

    await asOwner((sql) => sql`
      update runtime_task set available_at = now() where id = ${task.id}`);
    remoteStatus = 'completed';
    await expect(handleRuntimeMessage(env, message, { provider, fetch: fetcher }))
      .resolves.toEqual({ action: 'ack', reason: 'completed' });

    const [completed] = await asOwner((sql) => sql<{
      status: string; remote_status: string; result: unknown;
    }[]>`select status, remote_status, result from runtime_task where id = ${task.id}`);
    expect(completed).toEqual({
      status: 'completed', remote_status: 'completed', result: 'The business is ready.',
    });
    const [secondPoll] = await asOwner((sql) => sql<{ attempt: number }[]>`
      select attempt from runtime_task where id = ${task.id}`);
    expect(secondPoll.attempt).toBe(0);
    const [finished] = await asOwner((sql) => sql<{ status: string }[]>`
      select status from run where id = ${run.id}`);
    expect(finished.status).toBe('completed');
    const events = await asOwner((sql) => sql<{ type: string }[]>`
      select type from run_event where run_id = ${run.id} order by seq`);
    expect(events.map((event) => event.type)).toEqual([
      'work.requested', 'work.started', 'outcome.observed', 'work.completed',
    ]);
    const [usage] = await asOwner((sql) => sql<{
      status: string; input_tokens: string; output_tokens: string; cost_microusd: string;
      started_at: Date;
    }[]>`
      select status, input_tokens::text, output_tokens::text, cost_microusd::text, started_at
        from runtime_usage where runtime_task_id = ${task.id}`);
    expect(usage).toMatchObject({
      status: 'completed', input_tokens: '18000', output_tokens: '20', cost_microusd: '1083',
    });
    expect(usage.started_at.getTime()).toBe(startedUsage.started_at.getTime());
    expect(seen.every((call) => call.authorization === null)).toBe(true);
    expect(seen.every((call) => call.runnerKey === 'r'.repeat(64))).toBe(true);
  });

  it('polls a busy runtime after two seconds without consuming a failed attempt', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true,
          release: '2026.08.27-1',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks')) {
        return response({
          ok: false,
          error: 'runtime_busy',
          activeTaskId: '22222222-2222-4222-8222-222222222222',
        }, 409);
      }
      return response({ error: 'not found' }, 404);
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: fetcher },
    )).resolves.toEqual({
      action: 'requeue', delaySeconds: 2, reason: 'business runtime is busy',
    });
    const [state] = await asOwner((sql) => sql<{
      status: string; attempt: number; lease_token: string | null;
    }[]>`
      select status, attempt, lease_token from runtime_task where id = ${task.id}`);
    expect(state).toEqual({ status: 'queued', attempt: 0, lease_token: null });
  });

  it('retries instead of cancelling when the reservation expires before Hermes starts', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, env.AISAR_MODEL_NAME!));
    await asOwner((sql) => sql`
      update runtime_budget set max_run_seconds = 10 where business_id = ${A}`);
    await asOwner((sql) => sql`
      update runtime_usage set started_at = now() - interval '11 seconds'
       where runtime_task_id = ${task.id}`);

    let starts = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true,
          release: '2026.08.27-1',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') starts += 1;
      return response({ error: 'not found' }, 404);
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: fetcher },
    )).resolves.toEqual({
      action: 'requeue',
      delaySeconds: 30,
      reason: 'runtime task exceeded its time limit before Hermes started',
    });
    expect(starts).toBe(0);
    const [state] = await asOwner((sql) => sql<{
      status: string; attempt: number; remote_run_id: string | null; remote_status: string | null;
    }[]>`
      select status, attempt, remote_run_id, remote_status
        from runtime_task where id = ${task.id}`);
    expect(state).toEqual({
      status: 'failed', attempt: 1, remote_run_id: null, remote_status: null,
    });
    const events = await asOwner((sql) => sql<{ type: string }[]>`
      select type from run_event where run_id = ${run.id} order by seq`);
    expect(events.map((event) => event.type)).toEqual(['work.requested']);
  });

  it('still cancels an active Hermes run after its run-time limit', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, env.AISAR_MODEL_NAME!));
    await asOwner((sql) => sql`
      update runtime_budget set max_run_seconds = 10 where business_id = ${A}`);
    await asOwner((sql) => sql`
      update runtime_usage set started_at = now() - interval '11 seconds'
       where runtime_task_id = ${task.id}`);
    await asOwner((sql) => sql`
      update runtime_task
         set remote_run_id = 'run-active', remote_status = 'running', started_at = now()
       where id = ${task.id}`);

    let starts = 0;
    let stops = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true,
          release: '2026.08.27-1',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') starts += 1;
      if (url.endsWith(`/v1/tasks/${task.id}/stop`) && init?.method === 'POST') {
        stops += 1;
        return response({ ok: true, status: 'stopped' });
      }
      return response({ error: 'not found' }, 404);
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: fetcher },
    )).resolves.toEqual({ action: 'ack', reason: 'completed' });
    expect(starts).toBe(0);
    expect(stops).toBe(1);
    const [state] = await asOwner((sql) => sql<{
      task_status: string; remote_run_id: string; remote_status: string;
      usage_status: string; input_tokens: string; output_tokens: string;
    }[]>`
      select t.status as task_status, t.remote_run_id, t.remote_status,
             u.status as usage_status, u.input_tokens::text, u.output_tokens::text
        from runtime_task t join runtime_usage u on u.runtime_task_id = t.id
       where t.id = ${task.id}`);
    expect(state).toEqual({
      task_status: 'completed',
      remote_run_id: 'run-active',
      remote_status: 'cancelled',
      usage_status: 'cancelled',
      input_tokens: '0',
      output_tokens: '0',
    });
  });

  it('exhausts a budget-blocked task before waking provider or runner compute', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    await asOwner((sql) => sql`
      insert into runtime_budget
        (business_id, monthly_input_tokens, monthly_output_tokens,
         monthly_runtime_seconds, monthly_cost_microusd, max_run_seconds)
      values (${A}, 99999, 500000, 360000, 5000000, 900)`);
    let fetches = 0;
    const fetcher: typeof fetch = async () => {
      fetches += 1;
      return response({
        ok: true,
        toolMode: 'full-tools',
        webSearchBackend: 'ddgs',
        edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
      });
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: fetcher },
    )).resolves.toEqual({ action: 'ack', reason: 'failed' });
    expect(fetches).toBe(0);
    const [state] = await asOwner((sql) => sql<{ task: string; run: string }[]>`
      select t.status as task, r.status as run
        from runtime_task t join run r on r.id = t.run_id where t.id = ${task.id}`);
    expect(state).toEqual({ task: 'exhausted', run: 'failed' });
  });

  it('tells the owner the monthly AI credit cap was reached, on Telegram and in Activity', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('cap-owner@example.com', true) returning id`);
    const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '123456789',
      displayName: '@cap_bot',
      secret: '123456789:AAtoken',
      connectedBy: owner.id,
    }));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.message.telegram', runtime: 'hermes-sprite',
      model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`,
      payload: {
        input: 'hello', responseMode: 'quick',
        telegram: {
          connectionId: connection.id, chatId: 42, messageId: 7, from: 'Owner',
          question: 'hello', privateChat: true, liveMessageId: 77,
        },
      },
    }));
    /* A one-micro-dollar cost ceiling: the first reservation trips it. */
    await asOwner((sql) => sql`
      insert into runtime_budget
        (business_id, monthly_input_tokens, monthly_output_tokens,
         monthly_runtime_seconds, monthly_cost_microusd, max_run_seconds)
      values (${A}, 2000000, 500000, 360000, 1, 900)`);
    const edits: { chatId: number; messageId: number; text: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('editMessageText')) {
        const body = JSON.parse(String(init?.body)) as { chat_id: number; message_id: number; text: string };
        edits.push({ chatId: body.chat_id, messageId: body.message_id, text: body.text });
        return response({ ok: true, result: { message_id: body.message_id } });
      }
      return response({ ok: true, result: {} });
    }));

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider },
    )).resolves.toEqual({ action: 'ack', reason: 'failed' });

    /* The working bubble becomes the explanation, not a generic "try again". */
    const last = edits.at(-1)!;
    expect(last).toMatchObject({ chatId: 42, messageId: 77 });
    expect(last.text).toMatch(/credits/i);
    expect(last.text).toMatch(/US\$5/);
    /* And Activity carries the same reason, so the app agrees with the chat. */
    const [work] = await asOwner((sql) => sql<{ status: string; outcome: string }[]>`
      select status, outcome from work_record where run_id = ${run.id}`);
    expect(work.status).toBe('failed');
    expect(work.outcome).toMatch(/credits/i);
    vi.unstubAllGlobals();
  });

  it('stops and meters an existing remote run before exhausting its fifth real failure', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    await asTenant(A, async (tx) => {
      await reserveRuntimeUsage(tx, A, task.id, env.AISAR_MODEL_NAME!);
    });
    await asOwner((sql) => sql`
      update runtime_task
         set attempt = 4, remote_run_id = 'run-existing', remote_status = 'running',
             started_at = now()
       where id = ${task.id}`);

    let stops = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/v1/tasks/${task.id}/stop`) && init?.method === 'POST') {
        stops += 1;
        return response({
          ok: true,
          status: 'stopped',
          usage: { input_tokens: 12, output_tokens: 3 },
        });
      }
      if (url.endsWith('/readyz')) return response({ error: 'temporary runner failure' }, 503);
      return response({ error: 'not found' }, 404);
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: fetcher },
    )).resolves.toEqual({ action: 'ack', reason: 'failed' });
    expect(stops).toBe(1);
    const [state] = await asOwner((sql) => sql<{
      task_status: string; attempt: number; usage_status: string;
      input_tokens: string; output_tokens: string;
    }[]>`
      select t.status as task_status, t.attempt,
             u.status as usage_status, u.input_tokens::text, u.output_tokens::text
        from runtime_task t join runtime_usage u on u.runtime_task_id = t.id
       where t.id = ${task.id}`);
    expect(state).toEqual({
      task_status: 'exhausted',
      attempt: 5,
      usage_status: 'failed',
      input_tokens: '12',
      output_tokens: '3',
    });
  });

  it('does not finalize usage when another worker owns the lease at exhaustion', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: env.AISAR_MODEL_NAME,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, env.AISAR_MODEL_NAME!));
    await asOwner((sql) => sql`
      update runtime_task
         set attempt = 4, remote_run_id = 'run-existing', remote_status = 'running',
             started_at = now()
       where id = ${task.id}`);

    let leaseStolen = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        if (!leaseStolen) {
          leaseStolen = true;
          await asOwner((sql) => sql`
            update runtime_task
               set lease_token = 'concurrent-worker',
                   lease_expires_at = now() + interval '5 minutes'
             where id = ${task.id}`);
        }
        return response({ error: 'temporary runner failure' }, 503);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/stop`) && init?.method === 'POST') {
        return response({
          ok: true,
          status: 'stopped',
          usage: { input_tokens: 12, output_tokens: 3 },
        });
      }
      return response({ error: 'not found' }, 404);
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: fetcher },
    )).resolves.toEqual({
      action: 'requeue', delaySeconds: 10, reason: 'runtime task lease was lost',
    });
    const [state] = await asOwner((sql) => sql<{
      task_status: string; attempt: number; lease_token: string; usage_status: string;
    }[]>`
      select t.status as task_status, t.attempt, t.lease_token,
             u.status as usage_status
        from runtime_task t join runtime_usage u on u.runtime_task_id = t.id
       where t.id = ${task.id}`);
    expect(state).toEqual({
      task_status: 'leased',
      attempt: 4,
      lease_token: 'concurrent-worker',
      usage_status: 'reserved',
    });
  });
});

describe('RunnerClient capability attestation', () => {
  const baseReadyz = {
    ok: true,
    release: '2026.09.01-3',
    runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
    hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
    toolMode: 'full-tools',
    webSearchBackend: 'ddgs',
    edgeAuthorizationForwarded: false,
    specialistProfiles: { operations: true, customers: true, growth: true, records: true },
  };

  function client(expectedCapabilities: string[] | undefined, body: unknown) {
    return new RunnerClient({
      origin: 'https://sprite.test',
      runnerKey: 'r'.repeat(64),
      expectedCapabilities,
      fetch: async () => response(body),
    });
  }

  it('returns the capabilities attested on /readyz', async () => {
    const c = client(undefined, {
      ...baseReadyz,
      region: 'sin',
      capabilities: ['computer_use'],
    });
    /* `config` is null until a runtime runs a bundle that fetches one, and
        asserting that explicitly keeps the readiness shape pinned. */
    await expect(c.ready()).resolves.toEqual({
      region: 'sin',
      capabilities: ['computer_use'],
      specialistProfiles: ['operations', 'customers', 'growth', 'records'],
      config: null,
    });
  });

  it('accepts a runtime that attests every expected capability', async () => {
    const c = client(['computer_use'], {
      ...baseReadyz,
      capabilities: ['computer_use', 'web_search'],
      config: null,
    });
    await expect(c.ready()).resolves.toEqual({
      region: null,
      capabilities: ['computer_use', 'web_search'],
      specialistProfiles: ['operations', 'customers', 'growth', 'records'],
      config: null,
    });
  });

  it('fails closed when a required capability is missing from the attested list', async () => {
    const c = client(['computer_use'], { ...baseReadyz, capabilities: [] });
    await expect(c.ready())
      .rejects.toThrow('runner did not attest the computer_use capability');
  });

  it('fails closed when readyz carries no capabilities field at all', async () => {
    const c = client(['computer_use'], baseReadyz);
    await expect(c.ready())
      .rejects.toThrow('runner did not attest the computer_use capability');
  });

  it('names the first expected capability that was not attested', async () => {
    const c = client(['computer_use', 'web_search'], {
      ...baseReadyz,
      capabilities: ['computer_use'],
    });
    await expect(c.ready())
      .rejects.toThrow('runner did not attest the web_search capability');
  });

  it('filters non-string capability entries before attestation', async () => {
    const c = client(['computer_use'], {
      ...baseReadyz,
      capabilities: ['computer_use', 42, null, { id: 'web_search' }],
    });
    await expect(c.ready()).resolves.toEqual({
      region: null,
      capabilities: ['computer_use'],
      specialistProfiles: ['operations', 'customers', 'growth', 'records'],
      config: null,
    });
  });

  it('keeps a well-formed config attestation and drops nonsense', async () => {
    /* Diagnostic, not a gate: a runner reporting rubbish must cost the caller
       information, never the dispatch. So anything unrecognised becomes null
       rather than throwing. */
    const good = client(undefined, {
      ...baseReadyz,
      config: {
        schema: 1, version: 'fbd722a39cdc8738', source: 'control-plane',
        appliedAt: '2026-09-10T10:00:00Z', pendingVersion: 'aaaabbbbccccdddd',
      },
    });
    await expect(good.ready()).resolves.toMatchObject({
      config: {
        version: 'fbd722a39cdc8738',
        source: 'control-plane',
        appliedAt: '2026-09-10T10:00:00Z',
        pendingVersion: 'aaaabbbbccccdddd',
      },
    });

    for (const config of [null, 'nope', [], {}, { schema: 1 }]) {
      const c = client(undefined, { ...baseReadyz, config });
      await expect(c.ready()).resolves.toMatchObject({ config: null });
    }
  });

  it('treats an empty expectation list as no requirement', async () => {
    const c = client([], baseReadyz);
    await expect(c.ready()).resolves.toEqual({
      region: null,
      capabilities: [],
      specialistProfiles: ['operations', 'customers', 'growth', 'records'],
      config: null,
    });
  });
});

describe('RunnerClient runtime_busy surfaces the admission stamp', () => {
  function busyClient(body: unknown) {
    return new RunnerClient({
      origin: 'https://sprite.test',
      runnerKey: 'r'.repeat(64),
      fetch: async () => response(body, 409),
    });
  }

  it('throws RuntimeBusyError carrying activeTaskId and activeTaskStartedAt', async () => {
    const c = busyClient({
      ok: false,
      error: 'runtime_busy',
      activeTaskId: 'a-busy-task',
      activeTaskStartedAt: 1_760_000_000_000,
    });
    try {
      await c.start({ businessId: A, taskId: '2'.repeat(36), leaseToken: 'lease', input: 'hi' } as never);
      expect.unreachable('expected runtime_busy');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeBusyError);
      const busy = error as RuntimeBusyError;
      expect(busy.activeTaskId).toBe('a-busy-task');
      expect(busy.activeTaskStartedAt).toBe(1_760_000_000_000);
    }
  });

  it('tolerates a legacy runner that omits the admission stamp', async () => {
    const c = busyClient({ ok: false, error: 'runtime_busy', activeTaskId: 'a-busy-task' });
    try {
      await c.start({ businessId: A, taskId: '2'.repeat(36), leaseToken: 'lease', input: 'hi' } as never);
      expect.unreachable('expected runtime_busy');
    } catch (error) {
      const busy = error as RuntimeBusyError;
      expect(busy.activeTaskId).toBe('a-busy-task');
      expect(busy.activeTaskStartedAt).toBeNull();
    }
  });
});

describe('RunnerClient approval boundary', () => {
  it('forwards only valid Hermes iteration progress', async () => {
    const stream = [
      `data: ${JSON.stringify({ type: 'iteration', current: 0, total: 20 })}`,
      `data: ${JSON.stringify({ type: 'iteration', current: 12, total: 20 })}`,
      `data: ${JSON.stringify({ type: 'iteration', current: 21, total: 20 })}`,
      `data: ${JSON.stringify({ type: 'context.compressing', text: 'private context' })}`,
      `data: ${JSON.stringify({ type: 'done' })}`,
      '',
    ].join('\n\n');
    const client = new RunnerClient({
      origin: 'https://sprite.test',
      runnerKey: 'r'.repeat(64),
      fetch: async () => new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    });
    const iterations: Array<[number, number]> = [];
    const progress: string[] = [];
    await expect(client.stream('task-1', {
      onDelta: async () => {},
      onIteration: async (current, total) => { iterations.push([current, total]); },
      onProgress: async label => { progress.push(label); },
    })).resolves.toBeNull();
    expect(iterations).toEqual([[12, 20]]);
    expect(progress).toEqual(['Shortening conversation context before continuing…']);
  });

  it('returns a bounded approval event immediately and ignores forged shapes', async () => {
    const requestId = 'a'.repeat(32);
    const stream = [
      `data: ${JSON.stringify({
        type: 'approval', requestId: 'short', tool: 'execute_code', message: 'forged',
      })}`,
      `data: ${JSON.stringify({
        type: 'approval', requestId, tool: 'execute_code', message: 'Allow this code?',
      })}`,
      `data: ${JSON.stringify({ type: 'delta', delta: 'must not be consumed yet' })}`,
      '',
    ].join('\n\n');
    const client = new RunnerClient({
      origin: 'https://sprite.test',
      runnerKey: 'r'.repeat(64),
      fetch: async () => new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    });
    const deltas: string[] = [];
    await expect(client.stream('task-1', {
      onDelta: async (delta) => { deltas.push(delta); },
    })).resolves.toEqual({
      type: 'approval',
      requestId,
      tool: 'execute_code',
      message: 'Allow this code?',
    });
    expect(deltas).toEqual([]);
  });

  it('posts only the task-scoped request id and approve/deny decision', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const client = new RunnerClient({
      origin: 'https://sprite.test',
      runnerKey: 'r'.repeat(64),
      fetch: async (input, init) => {
        seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return response({ ok: true, status: 'running' });
      },
    });
    await client.decideApproval(
      '22222222-2222-4222-8222-222222222222',
      'b'.repeat(32),
      'deny',
    );
    expect(seen).toEqual([{
      url: 'https://sprite.test/v1/tasks/22222222-2222-4222-8222-222222222222/approval',
      body: { requestId: 'b'.repeat(32), decision: 'deny' },
    }]);
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Dispatch one run and return the body the worker sent the runner. */
async function dispatchBody(
  env: ReturnType<typeof testEnv>,
  payload: Record<string, unknown> = { input: 'hello', model: 'MiniMax-M3' },
): Promise<Record<string, unknown>> {
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.09.01-3', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'MiniMax-M3',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      runId: run.id,
      dedupeKey: `hold:${run.id}`,
      payload,
    }));
    let body: Record<string, unknown> | null = null;
    const runnerFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true,
          release: '2026.09.01-3',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response({ ok: true, hermesRunId: 'hold-run', status: 'running' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        const signal = init?.signal;
        return new Response(new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return response({ error: 'not found' }, 404);
    };
    await handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: runnerFetch, observationSliceMs: 30 },
    );
    if (!body) throw new Error('the runner was never dispatched');
    return body;
}

describe('sprite keepalive hold', () => {
  it('sends no hold when AISAR_KEEPALIVE_GRACE_HOURS is 0, so an idle sprite may pause', async () => {
    const body = await dispatchBody(testEnv({
      RUNTIME_RELEASE: '2026.09.01-3',
      AISAR_MODEL_NAME: 'MiniMax-M3',
      AISAR_KEEPALIVE_GRACE_HOURS: '0',
    }));
    expect(body).not.toHaveProperty('keepaliveUntil');
  });

  it('holds the sprite for the default 24 hours when the setting is absent', async () => {
    const before = Date.now();
    const body = await dispatchBody(testEnv({
      RUNTIME_RELEASE: '2026.09.01-3',
      AISAR_MODEL_NAME: 'MiniMax-M3',
    }));
    const until = Date.parse(String(body.keepaliveUntil));
    expect(until - before).toBeGreaterThan(23.9 * 3_600_000);
    expect(until - before).toBeLessThan(24.1 * 3_600_000);
  });
});

describe('per-run deadline by response mode', () => {
  const env = () => testEnv({ RUNTIME_RELEASE: '2026.09.01-3', AISAR_MODEL_NAME: 'MiniMax-M3' });

  /* On 2026-09-03 a two-word Telegram follow-up ran on the sprite for
     7 h 15 min before the per-run limit was applied. The runner enforces
     the deadline itself now; a chat turn that is still running after five
     minutes is stuck, and five minutes is what it should cost. */
  it('caps a quick reply at five minutes', async () => {
    const before = Date.now();
    const body = await dispatchBody(env(), { input: 'yo', model: 'MiniMax-M3', responseMode: 'quick' });
    const seconds = (Number(body.deadlineAt) - before) / 1_000;
    expect(seconds).toBeGreaterThan(290);
    expect(seconds).toBeLessThanOrEqual(305);
  });

  it('leaves deep work on the budget limit', async () => {
    const before = Date.now();
    const body = await dispatchBody(env(), { input: 'research this', model: 'deepseek-v4-flash', responseMode: 'deep' });
    const seconds = (Number(body.deadlineAt) - before) / 1_000;
    expect(seconds).toBeGreaterThan(890);
    expect(seconds).toBeLessThanOrEqual(905);
  });
});

describe('live progress to the web chat', () => {
  it("streams the agent's status, thinking and answer text to the run stream", async () => {
    const published: Array<Record<string, unknown>> = [];
    const env = testEnv({
      RUNTIME_RELEASE: '2026.09.01-3',
      AISAR_MODEL_NAME: 'MiniMax-M3',
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
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider, runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.09.01-3', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'MiniMax-M3',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `live:${run.id}`,
      payload: { input: 'Are we open on Sunday?', model: 'MiniMax-M3', responseMode: 'deep' },
    }));
    const events = [
      { type: 'thinking', text: 'checking the calendar' },
      { type: 'iteration', current: 1, total: 20 },
      { type: 'delta', delta: '@' },
      { type: 'delta', delta: 'step: Checking the opening hours\n' },
      { type: 'tool.started', tool: 'web_search', preview: 'opening hours' },
      { type: 'tool.started', tool: 'delegate_task', seq: 9, preview: 'Bounded research assignment' },
      { type: 'tool.completed', tool: 'delegate_task', seq: 10, duration: 1, error: false },
      { type: 'delta', delta: 'We are ' },
      { type: 'delta', delta: 'open on Sunday.' },
    ].map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
    const runnerFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true, release: '2026.09.01-3',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools', webSearchBackend: 'ddgs', edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'live-run', status: 'running' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        const signal = init?.signal;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(events));
            signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return response({ error: 'not found' }, 404);
    };
    await handleRuntimeMessage(
      env, { version: 1, businessId: A, taskId: task.id },
      { provider, fetch: runnerFetch, observationSliceMs: 600 },
    );
    const types = published.map((event) => event.type);
    expect(types).toContain('status');
    expect(published.find((event) => event.type === 'thinking')).toMatchObject({
      detail: expect.stringContaining('checking the calendar'),
    });
    expect(published.filter((event) => event.type === 'delta').map((event) => event.text).join(''))
      .toBe('We are open on Sunday.');
    /* Each status says what kind of thing it is, so the web can keep the
       agent's own steps and tools as a list and treat the rest as a label. */
    const statuses = published.filter((event) => event.type === 'status');
    expect(statuses).toContainEqual(expect.objectContaining({ detail: 'Checking the opening hours', kind: 'step' }));
    expect(statuses.find((event) => String(event.detail).includes('web_search'))).toMatchObject({ kind: 'tool' });
    expect(statuses.find((event) => String(event.detail).includes('System ready'))).toMatchObject({ kind: 'stage' });
    for (const event of published) {
      expect(event).toMatchObject({ businessId: A, runId: run.id });
    }
    /* The steps outlive the socket: they sit on the run's trace, so the
       run detail can hand them back after a reload or on another device. */
    const trace = await asTenant(A, (tx) => runTrace(tx, run.id));
    expect(trace).toContainEqual(expect.objectContaining({
      type: 'agent.step', payload: { detail: 'Checking the opening hours' },
    }));
    expect(trace.find((event) => event.type === 'agent.tool')).toMatchObject({
      payload: { tool: 'web_search', detail: expect.stringContaining('web_search') },
    });
    expect(trace.filter(event => event.type === 'agent.delegation').map(event => event.payload)).toEqual([
      { taskId: task.id, streamSeq: 9, stage: 'requested' },
      { taskId: task.id, streamSeq: 10, stage: 'returned' },
    ]);
  });
});

describe('conversation versus work', () => {
  /* Every web message became a "task": a run, a work record and a card in
     the chat and in Activity. A quick reply the agent answered from
     memory is conversation; deep mode or any tool use is work. */
  async function completeRun(
    env: ReturnType<typeof testEnv>,
    payload: Record<string, unknown>,
    events: Array<Record<string, unknown>>,
    expected: { action: string; reason: string } = { action: 'ack', reason: 'completed' },
    terminal: Record<string, unknown> = { status: 'completed', output: 'Yes, Sunday too.' },
  ) {
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, { provider, runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64) });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.09.01-3', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'MiniMax-M3',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `kind:${run.id}`,
      payload: { input: 'hello', model: 'MiniMax-M3', objective: 'hello', function: 'ask', channel: 'app', ...payload },
    }));
    const stream = [...events, { type: 'done' }].map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n';
    const runnerFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true, release: '2026.09.01-3',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools', webSearchBackend: 'ddgs', edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'kind-run', status: 'started' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.endsWith(`/v1/tasks/${task.id}`)) {
        return response({ ok: true, ...terminal });
      }
      return response({ error: 'not found' }, 404);
    };
    await expect(handleRuntimeMessage(env, { version: 1, businessId: A, taskId: task.id }, { provider, fetch: runnerFetch }))
      .resolves.toEqual(expected);
    const [record] = await asOwner((sql) => sql<{ kind: string; status: string; outcome: string | null }[]>`
      select kind, status, outcome from work_record where run_id = ${run.id}`);
    const tools = await asOwner((sql) => sql<{ n: string }[]>`
      select count(*)::text as n from run_event where run_id = ${run.id} and type = 'agent.tool'`);
    const [assessment] = await asTenant(A, (tx) => tx<{ payload: Record<string, unknown> }[]>`
      select payload from run_event where run_id = ${run.id} and type = 'outcome.observed'
        and payload->>'assessmentVersion' = '1' order by seq desc limit 1`);
    return { record, toolEvents: Number(tools[0].n), assessment: assessment?.payload };
  }
  const env = () => testEnv({ RUNTIME_RELEASE: '2026.09.01-3', AISAR_MODEL_NAME: 'MiniMax-M3' });

  it('records a quick reply answered without tools as conversation', async () => {
    const { record, toolEvents } = await completeRun(env(), { responseMode: 'quick' }, [
      { type: 'delta', delta: 'Yes, Sunday too.' },
    ]);
    expect(record).toMatchObject({ kind: 'conversation', status: 'completed' });
    expect(toolEvents).toBe(0);
  });

  it('keeps a searched answer as conversation, with the tool still on the run trace', async () => {
    const { record, toolEvents } = await completeRun(env(), { responseMode: 'quick' }, [
      { type: 'tool.started', tool: 'web_search', preview: 'opening hours' },
      { type: 'delta', delta: 'Yes, Sunday too.' },
    ]);
    expect(record).toMatchObject({ kind: 'conversation', status: 'completed' });
    expect(toolEvents).toBe(1);
  });

  it('does not turn deep reasoning into a task', async () => {
    const { record } = await completeRun(env(), { responseMode: 'deep' }, [
      { type: 'delta', delta: 'Here is the analysis.' },
    ]);
    expect(record).toMatchObject({ kind: 'conversation', status: 'completed' });
  });

  it('finishes the agent run without completing a login that needs the owner', async () => {
    const test = env();
    test.AI = { run: async () => ({ response: JSON.stringify({ kind: 'work', status: 'needs_input',
      intentEvidence: 'can u do wrangler login', completionCriteria: 'The Cloudflare account is authenticated.' }) }) } as unknown as typeof test.AI;
    const { record } = await completeRun(test, { input: 'can u do wrangler login' }, [
      { type: 'tool.started', tool: 'terminal', preview: 'wrangler login' },
    ]);
    expect(record).toMatchObject({ kind: 'work', status: 'needs_input' });
  });

  it('does not claim completion when the outcome assessor returns invalid data', async () => {
    const test = env();
    test.AI = { run: async () => ({ response: 'not JSON' }) } as unknown as typeof test.AI;
    const { record, assessment } = await completeRun(test, {}, []);
    // An unavailable classifier is not a delivered result needing review.
    // Keep the reply in chat, exclude it from work counters, retain uncertainty.
    expect(record).toMatchObject({ kind: 'conversation', status: 'completed' });
    expect(assessment).toMatchObject({ classification: 'uncertain', uncertaintyReason: 'classifier_unavailable', uncertaintyDetail: 'unparseable' });
  });

  /* A failed "yo bro" sat at the top of the daily brief as "a task needs
     another look" (2026-09-10). A failure is classified like a completion:
     quick and no tool means conversation, whatever went wrong. */
  it("records the provider's own quota error as an owner-facing notice, never the raw text", async () => {
    const raw = 'HTTP 429: litellm.RateLimitError: RateLimitError: OpenAIException - ' +
      'Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage.';
    /* The consumer acks a runner-reported failure as processed ("completed"
       is the delivery, not the run); the record is what the owner sees. */
    const { record } = await completeRun(env(), { responseMode: 'quick' }, [],
      { action: 'ack', reason: 'completed' }, { status: 'failed', error: raw });
    expect(record).toMatchObject({ kind: 'conversation', status: 'failed', outcome: FAILURE_NOTICES.provider_quota });
  });

  it('records a quick reply that failed at the credit cap as conversation, not a task', async () => {
    await asTenant(A, (tx) => tx`
      insert into runtime_budget (business_id, monthly_cost_microusd) values (${A}, 100)`);
    const { record } = await completeRun(env(), { responseMode: 'quick' }, [
      { type: 'delta', delta: 'Yes.' },
    ], { action: 'ack', reason: 'failed' });
    expect(record).toMatchObject({ kind: 'conversation', status: 'failed' });
  });
});

describe('resuming a run stream across observation slices', () => {
  /* The runner replays a task's whole event history to every subscriber.
     A second slice (or an approval resume) therefore saw the same deltas
     again and the web chat printed the answer twice. The last relayed seq
     is persisted with the task and the next slice skips the replay. */
  it('skips events at or before afterSeq and reports each relayed seq', async () => {
    const stream = [1, 2, 3, 4]
      .map((seq) => `data: ${JSON.stringify({ type: 'delta', seq, delta: `d${seq} ` })}`)
      .concat([`data: ${JSON.stringify({ type: 'done' })}`, ''])
      .join('\n\n');
    const client = new RunnerClient({
      origin: 'https://sprite.test',
      runnerKey: 'r'.repeat(64),
      fetch: async () => new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    });
    const deltas: string[] = [];
    const seqs: number[] = [];
    await expect(client.stream('task-1', {
      onDelta: async (delta) => { deltas.push(delta); },
      onSeq: (seq) => { seqs.push(seq); },
    }, { afterSeq: 2 })).resolves.toBeNull();
    expect(deltas).toEqual(['d3 ', 'd4 ']);
    expect(seqs).toEqual([3, 4]);
  });

  it('persists the last relayed seq at the slice end and skips the replay on re-attach', async () => {
    const published: Array<Record<string, unknown>> = [];
    const env = testEnv({
      RUNTIME_RELEASE: '2026.09.01-3',
      AISAR_MODEL_NAME: 'MiniMax-M3',
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
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider, runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.09.01-3', 'v1'));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'MiniMax-M3',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `resume:${run.id}`,
      payload: {
        input: 'Are we open on Sunday?', model: 'MiniMax-M3', responseMode: 'quick',
        objective: 'Are we open on Sunday?', function: 'ask', channel: 'app',
      },
    }));
    const sse = (events: Array<Record<string, unknown>>) =>
      events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
    const first = [
      { type: 'delta', seq: 1, delta: 'We are ' },
      { type: 'delta', seq: 2, delta: 'open ' },
    ];
    let attached = 0;
    const runnerFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return response({
          ok: true, release: '2026.09.01-3',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
          toolMode: 'full-tools', webSearchBackend: 'ddgs', edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'resume-run', status: 'running' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        attached += 1;
        if (attached === 1) {
          const signal = init?.signal;
          return new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sse(first)));
              signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
            },
          }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return new Response(
          sse([...first, { type: 'delta', seq: 3, delta: 'on Sunday.' }, { type: 'done' }]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      if (url.endsWith(`/v1/tasks/${task.id}`)) {
        return response({
          ok: true,
          status: attached < 2 ? 'running' : 'completed',
          output: 'We are open on Sunday.',
        });
      }
      return response({ error: 'not found' }, 404);
    };
    const message = { version: 1 as const, businessId: A, taskId: task.id };
    await expect(handleRuntimeMessage(
      env, message, { provider, fetch: runnerFetch, observationSliceMs: 600 },
    )).resolves.toMatchObject({ action: 'requeue', reason: 'bounded observation slice completed' });
    const [parked] = await asOwner((sql) => sql<{ stream_seq: number; status: string }[]>`
      select stream_seq, status from runtime_task where id = ${task.id}`);
    expect(parked).toEqual({ stream_seq: 2, status: 'queued' });

    await asOwner((sql) => sql`update runtime_task set available_at = now() where id = ${task.id}`);
    await expect(handleRuntimeMessage(env, message, { provider, fetch: runnerFetch }))
      .resolves.toEqual({ action: 'ack', reason: 'completed' });
    expect(attached).toBe(2);
    expect(published.filter((event) => event.type === 'delta').map((event) => event.text).join(''))
      .toBe('We are open on Sunday.');
    /* A quick reply is a conversation, not a research task: the label that
       waits for the first token says so. */
    const statuses = published.filter((event) => event.type === 'status').map((event) => event.detail);
    expect(statuses).toContain('💭 Thinking…');
    expect(statuses.join(' ')).not.toContain('Researching');
  });
});
