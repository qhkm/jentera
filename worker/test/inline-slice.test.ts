import { beforeEach, describe, expect, it } from 'vitest';
import { markRuntimeReady } from '../src/agent-runtime';
import { startRun } from '../src/runs';
import { LocalRuntimeProvider } from '../src/runtime';
import { runInlineSlice } from '../src/runtime/inline-slice';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { enqueueRuntimeTask, leaseRuntimeTask } from '../src/runtime/tasks';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const RELEASE = '2026.09.01-3';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

describe('the inline first slice behind another reply', () => {
  /* A business runs one reply at a time. A message that arrived while the
     previous one was still running was parked for the queue's watchdog and
     came back through the far consumer: 18.6 s to Hermes on 2026-09-10 while
     the neighbouring messages took 1.0 to 1.3 s. The placed slice now waits
     for the slot itself and tells the owner why. */
  it('waits for the slot inline, says so, and then answers without a queue handover', async () => {
    const published: Array<Record<string, unknown>> = [];
    const queued: unknown[] = [];
    const env = testEnv({
      RUNTIME_RELEASE: RELEASE,
      AISAR_MODEL_NAME: 'MiniMax-M3',
      RUNTIME_QUEUE: { send: async (message: unknown) => { queued.push(message); } },
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
    await asTenant(A, (tx) => markRuntimeReady(tx, A, RELEASE, 'v1'));

    /* The reply already running: a leased sibling with a fresh heartbeat. */
    const running = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', dedupeKey: 'running', payload: {},
    }));
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, running.id, 'sibling-lease', 300))).outcome).toBe('leased');

    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'MiniMax-M3',
    }));
    const waiting = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `ask:${run.id}`,
      payload: {
        input: 'hi', model: 'MiniMax-M3', responseMode: 'quick',
        objective: 'hi', function: 'ask', channel: 'app',
      },
    }));
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
        return Response.json({ ok: true, hermesRunId: 'behind-run', status: 'running' }, { status: 202 });
      }
      if (url.endsWith(`/v1/tasks/${waiting.id}/events`)) {
        const body = [{ type: 'delta', seq: 1, delta: 'Hello.' }, { type: 'done' }]
          .map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.endsWith(`/v1/tasks/${waiting.id}`)) {
        return Response.json({ ok: true, status: 'completed', output: 'Hello.' });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    };

    /* The previous reply finishes while the new one is waiting. */
    setTimeout(() => {
      void asOwner((sql) => sql`
        update runtime_task
           set status = 'completed', lease_token = null, lease_expires_at = null,
               lease_heartbeat_at = null, completed_at = now()
         where id = ${running.id}`);
    }, 700);

    await runInlineSlice(env, { version: 1, businessId: A, taskId: waiting.id }, {
      provider, fetch: runnerFetch, observationSliceMs: 8_000, busyPollMs: 200,
    });

    const [row] = await asOwner((sql) => sql<{ status: string }[]>`
      select status from run where id = ${run.id}`);
    expect(row.status).toBe('completed');
    expect(published.filter((event) => event.type === 'status').map((event) => event.detail))
      .toContain('⏳ Finishing your previous message first…');
    expect(published.filter((event) => event.type === 'delta').map((event) => event.text).join(''))
      .toBe('Hello.');
    expect(queued).toEqual([]);
  });
});
