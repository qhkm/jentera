import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import {
  finalizeRuntimeUsage,
  reserveRuntimeUsage,
  runtimeBudgetSnapshot,
  RuntimeBudgetExceeded,
} from '../src/runtime/usage';
import { asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const MODEL = 'deepseek/deepseek-v4-flash-0731';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key)
    values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'salon')`);
});

describe('runtime usage safety ledger', () => {
  it('reserves exactly once and replaces the reservation with measured usage', async () => {
    const task = await runTask(A);
    const first = await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, MODEL));
    const second = await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, MODEL));
    expect(second.startedAt.getTime()).toBe(first.startedAt.getTime());

    await asTenant(A, (tx) => finalizeRuntimeUsage(tx, A, task.id, 'completed', {
      inputTokens: 18_000,
      outputTokens: 20,
    }));
    const snapshot = await asTenant(A, (tx) => runtimeBudgetSnapshot(tx, A));
    expect(snapshot.usage.inputTokens).toBe(18_000);
    expect(snapshot.usage.outputTokens).toBe(20);
    expect(snapshot.usage.costMicrousd).toBe(1_083);

    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from runtime_usage where runtime_task_id = ${task.id}`);
    expect(count).toBe('1');
  });

  it('fails closed before compute when any tenant ceiling is exhausted', async () => {
    const task = await runTask(A);
    await asTenant(A, (tx) => tx`
      insert into runtime_budget
        (business_id, monthly_input_tokens, monthly_output_tokens,
         monthly_runtime_seconds, monthly_cost_microusd, max_run_seconds)
      values (${A}, 99999, 500000, 360000, 5000000, 900)`);
    await expect(asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, MODEL)))
      .rejects.toEqual(expect.objectContaining<Partial<RuntimeBudgetExceeded>>({
        code: 'RUNTIME_BUDGET_EXCEEDED',
        dimension: 'input_tokens',
      }));
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from runtime_usage where business_id = ${A}`);
    expect(count).toBe('0');
  });

  it('charges the reservation instead of zero when abnormal usage is unknown', async () => {
    const task = await runTask(A);
    await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, MODEL));
    await asTenant(A, (tx) => finalizeRuntimeUsage(tx, A, task.id, 'failed'));

    const snapshot = await asTenant(A, (tx) => runtimeBudgetSnapshot(tx, A));
    expect(snapshot.usage.inputTokens).toBe(100_000);
    expect(snapshot.usage.outputTokens).toBe(25_000);
    expect(snapshot.usage.costMicrousd).toBe(9_000);
  });

  it('prices MiniMax-M3 runs on the customer-pinned route', async () => {
    const task = await runTask(A);
    await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, 'MiniMax-M3'));
    await asTenant(A, (tx) => finalizeRuntimeUsage(tx, A, task.id, 'completed', {
      inputTokens: 18_000,
      outputTokens: 20,
    }));
    const snapshot = await asTenant(A, (tx) => runtimeBudgetSnapshot(tx, A));
    // (18000*30 + 20*120) / 100 = 5424 micro-USD
    expect(snapshot.usage.costMicrousd).toBe(5_424);
  });

  it('does not expose one business usage to another tenant', async () => {
    const task = await runTask(A);
    await asTenant(A, (tx) => reserveRuntimeUsage(tx, A, task.id, MODEL));
    const [{ count }] = await asTenant(B, (tx) => tx<{ count: string }[]>`
      select count(*)::text as count from runtime_usage`);
    expect(count).toBe('0');
  });
});

const runTask = (businessId: string) => asTenant(businessId, (tx) =>
  enqueueRuntimeTask(tx, businessId, {
    kind: 'run',
    dedupeKey: `run:${crypto.randomUUID()}`,
    payload: { input: 'hello' },
  }));
