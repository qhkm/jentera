import { beforeEach, describe, expect, it } from 'vitest';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';
import { ensureProviderRuntime, handleRuntimeMessage, LocalRuntimeProvider } from '../src/runtime';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import type { DesiredRuntime, ObservedRuntime, RuntimeProvider } from '../src/runtime';
import { storeRuntimeModelCredential } from '../src/agent-runtime';
import { startRun } from '../src/runs';

const A = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

describe('the runtime queue consumer', () => {
  it('leases, provisions, and completes one durable task', async () => {
    const task = await provisionTask();
    const result = await handleRuntimeMessage(
      testEnv({ RUNTIME_RELEASE: '2026.08.27-1' }),
      { version: 1, businessId: A, taskId: task.id },
      { provider: new LocalRuntimeProvider() },
    );
    expect(result).toEqual({ action: 'ack', reason: 'completed' });
    expect((await taskStatus(task.id)).status).toBe('completed');
    const [runtime] = await asOwner((sql) => sql<{ provider_id: string | null }[]>`
      select provider_id from agent_runtime where business_id = ${A}`);
    expect(runtime.provider_id).toBeTruthy();
  });

  it('acknowledges duplicate delivery without provisioning twice', async () => {
    const task = await provisionTask();
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const provider = new LocalRuntimeProvider();
    const message = { version: 1 as const, businessId: A, taskId: task.id };
    await handleRuntimeMessage(env, message, { provider });
    expect(await handleRuntimeMessage(env, message, { provider }))
      .toEqual({ action: 'ack', reason: 'already_done' });
  });

  it('releases a failed lease before asking Queue to retry', async () => {
    const task = await provisionTask();
    const broken: RuntimeProvider = {
      id: 'local',
      create: async (_runtime: DesiredRuntime) => { throw new Error('provider unavailable'); },
      wake: async (runtime: ObservedRuntime) => runtime,
      stop: async () => {},
      status: async (runtime: ObservedRuntime) => runtime,
      checkpoint: async () => 'v1',
      restore: async () => {},
      destroy: async () => {},
    };
    const result = await handleRuntimeMessage(
      testEnv({ RUNTIME_RELEASE: '2026.08.27-1' }),
      { version: 1, businessId: A, taskId: task.id },
      { provider: broken },
    );
    expect(result.action).toBe('requeue');
    const row = await taskStatus(task.id);
    expect(row.status).toBe('failed');
    expect(row.lease_token).toBeNull();
  });

  it('drops malformed messages without touching Postgres', async () => {
    expect(await handleRuntimeMessage(
      testEnv(),
      { version: 1, businessId: 'not-a-uuid', taskId: 'also-not' },
    )).toEqual({ action: 'ack', reason: 'missing' });
  });

  it('stops retrying a permanently broken provider after five attempts', async () => {
    const task = await provisionTask();
    const broken: RuntimeProvider = {
      id: 'local',
      create: async () => { throw new Error('still unavailable'); },
      wake: async (runtime) => runtime,
      stop: async () => {},
      status: async (runtime) => runtime,
      checkpoint: async () => 'v1',
      restore: async () => {},
      destroy: async () => {},
    };
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const message = { version: 1 as const, businessId: A, taskId: task.id };
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await handleRuntimeMessage(env, message, { provider: broken });
      expect(result.action).toBe('requeue');
      await asOwner((sql) => sql`
        update runtime_task set available_at = now() where id = ${task.id}`);
    }
    expect(await handleRuntimeMessage(env, message, { provider: broken }))
      .toEqual({ action: 'ack', reason: 'failed' });
    expect((await taskStatus(task.id)).status).toBe('exhausted');
    expect(await handleRuntimeMessage(env, message, { provider: broken }))
      .toEqual({ action: 'ack', reason: 'already_done' });
  });

  it('durably deletes provider compute and encrypted runtime credentials', async () => {
    const provider = new LocalRuntimeProvider();
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const provision = await provisionTask();
    await handleRuntimeMessage(env, { version: 1, businessId: A, taskId: provision.id }, { provider });
    const deletion = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'delete', dedupeKey: 'delete:test',
    }));
    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: deletion.id },
      { provider },
    )).resolves.toEqual({ action: 'ack', reason: 'completed' });
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from agent_runtime where business_id = ${A}`);
    expect(count).toBe('0');
  });

  it('defers active work behind one on-demand model-key rotation', async () => {
    const sent: unknown[] = [];
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_OPENROUTER_MANAGEMENT_KEY: 'm'.repeat(32),
      RUNTIME_QUEUE: { send: async (message: unknown) => { sent.push(message); } },
    });
    await ensureProviderRuntime(env, A, {
      provider: new LocalRuntimeProvider(),
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => storeRuntimeModelCredential(env, tx, A, {
      key: `sk-or-${'k'.repeat(40)}`,
      hash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    }));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'test-model',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));

    await expect(handleRuntimeMessage(env, {
      version: 1, businessId: A, taskId: task.id,
    })).resolves.toEqual({
      action: 'requeue', delaySeconds: 30, reason: 'runtime credential maintenance',
    });
    const rows = await asOwner((sql) => sql<{ kind: string; status: string }[]>`
      select kind, status from runtime_task where business_id = ${A} order by kind`);
    expect(rows).toEqual([
      { kind: 'run', status: 'queued' },
      { kind: 'upgrade', status: 'queued' },
    ]);
    expect(sent).toHaveLength(1);
  });
});

const provisionTask = () => asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
  kind: 'provision',
  dedupeKey: `provision:${A}`,
}));

const taskStatus = (id: string) => asOwner(async (sql) => {
  const [row] = await sql<{ status: string; lease_token: string | null }[]>`
    select status, lease_token from runtime_task where id = ${id}`;
  return row;
});
