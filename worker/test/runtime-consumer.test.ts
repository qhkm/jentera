import { beforeEach, describe, expect, it } from 'vitest';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';
import { handleRuntimeMessage, LocalRuntimeProvider } from '../src/runtime';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import type { DesiredRuntime, ObservedRuntime, RuntimeProvider } from '../src/runtime';

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
    expect(result.action).toBe('retry');
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

