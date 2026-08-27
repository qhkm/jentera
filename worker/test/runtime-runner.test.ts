import { beforeEach, describe, expect, it } from 'vitest';
import { markRuntimeReady } from '../src/agent-runtime';
import { startRun } from '../src/runs';
import { handleRuntimeMessage, LocalRuntimeProvider } from '../src/runtime';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

describe('durable Hermes run delivery', () => {
  it('starts once, defers polling, then completes the AISAR history atomically', async () => {
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
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
      if (url.endsWith('/readyz')) return response({ ok: true });
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return response({ ok: true, hermesRunId: 'run-hermes-1', status: 'started' }, 202);
      }
      if (url.endsWith(`/v1/tasks/${task.id}`)) {
        return response({
          ok: true,
          status: remoteStatus,
          output: remoteStatus === 'completed' ? 'The business is ready.' : undefined,
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
    const [finished] = await asOwner((sql) => sql<{ status: string }[]>`
      select status from run where id = ${run.id}`);
    expect(finished.status).toBe('completed');
    const events = await asOwner((sql) => sql<{ type: string }[]>`
      select type from run_event where run_id = ${run.id} order by seq`);
    expect(events.map((event) => event.type)).toEqual([
      'work.requested', 'work.started', 'work.completed',
    ]);
    expect(seen.every((call) => call.authorization === null)).toBe(true);
    expect(seen.every((call) => call.runnerKey === 'r'.repeat(64))).toBe(true);
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
