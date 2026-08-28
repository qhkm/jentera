import { beforeEach, describe, expect, it } from 'vitest';
import { asOwner, asTenant, truncateAll } from './harness';
import {
  completeRuntimeTask,
  enqueueRuntimeTask,
  leaseRuntimeTask,
  renewRuntimeTaskLease,
  retryRuntimeTask,
} from '../src/runtime/tasks';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key)
    values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'salon')`);
});

describe('durable runtime tasks', () => {
  it('deduplicates the event that asks for work', async () => {
    const first = await queued(A, 'provision:first');
    const second = await queued(A, 'provision:first');
    expect(second.id).toBe(first.id);
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from runtime_task`);
    expect(count).toBe('1');
  });

  it('leases only one task for a business', async () => {
    const first = await queued(A, 'run:1');
    const second = await queued(A, 'run:2');
    expect((await lease(A, first.id, 'lease-1')).outcome).toBe('leased');
    expect((await lease(A, second.id, 'lease-2')).outcome).toBe('busy');
  });

  it('turns simultaneous lease attempts into leased plus busy, never a unique-index error', async () => {
    const first = await queued(A, 'run:race-1');
    const second = await queued(A, 'run:race-2');
    const outcomes = await Promise.all([
      lease(A, first.id, 'lease-race-1'),
      lease(A, second.id, 'lease-race-2'),
    ]);

    expect(outcomes.map((result) => result.outcome).sort()).toEqual(['busy', 'leased']);
  });

  it('allows different businesses to work concurrently', async () => {
    const first = await queued(A, 'run:1');
    const second = await queued(B, 'run:1');
    expect((await lease(A, first.id, 'lease-a')).outcome).toBe('leased');
    expect((await lease(B, second.id, 'lease-b')).outcome).toBe('leased');
  });

  it('makes a duplicate delivery harmless after completion', async () => {
    const row = await queued(A, 'run:1');
    expect((await lease(A, row.id, 'lease-1')).outcome).toBe('leased');
    expect(await asTenant(A, (tx) => completeRuntimeTask(tx, A, row.id, 'lease-1')))
      .toBe(true);
    expect((await lease(A, row.id, 'lease-2')).outcome).toBe('done');
  });

  it('refuses completion by someone without the lease', async () => {
    const row = await queued(A, 'run:1');
    await lease(A, row.id, 'right-lease');
    expect(await asTenant(A, (tx) =>
      completeRuntimeTask(tx, A, row.id, 'wrong-lease'))).toBe(false);
  });

  it('releases failed work for a delayed retry', async () => {
    const row = await queued(A, 'run:1');
    await lease(A, row.id, 'lease-1');
    expect(await asTenant(A, (tx) =>
      retryRuntimeTask(tx, A, row.id, 'lease-1', 'temporary failure', 0))).toBe(true);
    const retried = await lease(A, row.id, 'lease-2');
    expect(retried.outcome).toBe('leased');
    if (retried.outcome === 'leased') expect(retried.task.attempt).toBe(1);
  });

  it('reclaims an expired lease', async () => {
    const row = await queued(A, 'run:1');
    await lease(A, row.id, 'old-lease');
    await asOwner((sql) => sql`
      update runtime_task set lease_expires_at = now() - interval '1 second'
       where id = ${row.id}`);
    expect((await lease(A, row.id, 'new-lease')).outcome).toBe('leased');
  });

  it('renews only the invocation that owns a streaming lease', async () => {
    const row = await queued(A, 'run:stream');
    await lease(A, row.id, 'stream-owner');
    expect(await asTenant(A, (tx) =>
      renewRuntimeTaskLease(tx, A, row.id, 'wrong-owner'))).toBe(false);
    expect(await asTenant(A, (tx) =>
      renewRuntimeTaskLease(tx, A, row.id, 'stream-owner'))).toBe(true);
  });

  it('keeps another tenant from leasing a guessed task', async () => {
    const row = await queued(A, 'run:1');
    expect((await lease(B, row.id, 'stolen')).outcome).toBe('missing');
  });
});

const queued = (businessId: string, dedupeKey: string) =>
  asTenant(businessId, (tx) => enqueueRuntimeTask(tx, businessId, {
    kind: dedupeKey.startsWith('provision') ? 'provision' : 'run',
    dedupeKey,
  }));

const lease = (businessId: string, taskId: string, token: string) =>
  asTenant(businessId, (tx) => leaseRuntimeTask(tx, businessId, taskId, token));
