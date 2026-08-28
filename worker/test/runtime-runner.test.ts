import { beforeEach, describe, expect, it } from 'vitest';
import { markRuntimeReady } from '../src/agent-runtime';
import { startRun } from '../src/runs';
import { handleRuntimeMessage, LocalRuntimeProvider } from '../src/runtime';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { reserveRuntimeUsage } from '../src/runtime/usage';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

describe('durable Hermes run delivery', () => {
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
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'run-hermes-1', status: 'started' }, 202);
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
      'work.requested', 'work.started', 'work.completed',
    ]);
    const [usage] = await asOwner((sql) => sql<{
      status: string; input_tokens: string; output_tokens: string; cost_microusd: string;
    }[]>`
      select status, input_tokens::text, output_tokens::text, cost_microusd::text
        from runtime_usage where runtime_task_id = ${task.id}`);
    expect(usage).toEqual({
      status: 'completed', input_tokens: '18000', output_tokens: '20', cost_microusd: '1083',
    });
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
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
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

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
