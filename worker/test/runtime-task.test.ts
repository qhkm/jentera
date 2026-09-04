import { beforeEach, describe, expect, it } from 'vitest';
import { asOwner, asTenant, truncateAll } from './harness';
import {
  claimRuntimeApprovalDecision,
  completeRuntimeApprovalDecision,
  completeRuntimeTask,
  enqueueRuntimeTask,
  leaseRuntimeTask,
  nextWaitingRuntimeTaskId,
  pauseRuntimeTaskForApproval,
  reclaimRuntimeTaskLease,
  renewRuntimeTaskLease,
  retryRuntimeTask,
} from '../src/runtime/tasks';
import { lifecycleRetryDelaySeconds } from '../src/runtime/consumer';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333';

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
    await asOwner((sql) => sql`
      update runtime_task set remote_run_id = 'hermes-1', remote_status = 'running'
       where id = ${first.id}`);
    const blocked = await lease(A, second.id, 'lease-2');
    expect(blocked).toMatchObject({
      outcome: 'busy',
      leasedId: first.id,
      selfLeased: false,
      leasedRemoteRunId: 'hermes-1',
      leasedRemoteStatus: 'running',
    });
    if (blocked.outcome === 'busy') {
      expect(blocked.leasedLeaseExpiresAt).toBeInstanceOf(Date);
      expect(blocked.siblingLeaseExpiresAt).toEqual(blocked.leasedLeaseExpiresAt);
    }
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

  it('does not hand off an expired lease before explicit reclaim', async () => {
    const row = await queued(A, 'run:1');
    await lease(A, row.id, 'old-lease');
    await asOwner((sql) => sql`
      update runtime_task set lease_expires_at = now() - interval '1 second'
       where id = ${row.id}`);
    expect((await lease(A, row.id, 'new-lease')).outcome).toBe('busy');
    expect(await asTenant(A, (tx) =>
      reclaimRuntimeTaskLease(tx, A, row.id, 'orphan_reclaimed'))).toBe(true);
    expect((await lease(A, row.id, 'new-lease')).outcome).toBe('leased');
  });

  it('does not reclaim a fresh runtime task lease', async () => {
    const row = await queued(A, 'run:reclaim-fresh');
    await lease(A, row.id, 'fresh-lease');

    expect(await asTenant(A, (tx) =>
      reclaimRuntimeTaskLease(tx, A, row.id, 'orphan_reclaimed'))).toBe(false);
    const [state] = await asOwner((sql) => sql<{
      status: string; attempt: number; lease_token: string | null; last_error: string | null;
    }[]>`
      select status, attempt, lease_token, last_error
        from runtime_task where id = ${row.id}`);
    expect(state).toMatchObject({
      status: 'leased',
      attempt: 0,
      lease_token: 'fresh-lease',
      last_error: null,
    });
  });

  it('reclaims a stale runtime task lease once and records the orphan', async () => {
    const row = await queued(A, 'run:reclaim-stale');
    await lease(A, row.id, 'stale-lease');
    await asOwner((sql) => sql`
      update runtime_task set lease_expires_at = now() + interval '30 seconds'
       where id = ${row.id}`);

    expect(await asTenant(A, (tx) =>
      reclaimRuntimeTaskLease(tx, A, row.id, 'orphan_reclaimed'))).toBe(true);
    expect(await asTenant(A, (tx) =>
      reclaimRuntimeTaskLease(tx, A, row.id, 'orphan_reclaimed'))).toBe(false);
    const [state] = await asOwner((sql) => sql<{
      status: string;
      attempt: number;
      lease_token: string | null;
      lease_expires_at: Date | null;
      last_error: string | null;
    }[]>`
      select status, attempt, lease_token, lease_expires_at, last_error
        from runtime_task where id = ${row.id}`);
    expect(state).toEqual({
      status: 'failed',
      attempt: 1,
      lease_token: null,
      lease_expires_at: null,
      last_error: 'orphan_reclaimed',
    });
  });

  it('renews only the invocation that owns a fresh streaming lease', async () => {
    const row = await queued(A, 'run:stream');
    await lease(A, row.id, 'stream-owner');
    expect(await asTenant(A, (tx) =>
      renewRuntimeTaskLease(tx, A, row.id, 'wrong-owner'))).toBe(false);
    expect(await asTenant(A, (tx) =>
      renewRuntimeTaskLease(tx, A, row.id, 'stream-owner'))).toBe(true);
    await asOwner((sql) => sql`
      update runtime_task set lease_expires_at = now() + interval '30 seconds'
       where id = ${row.id}`);
    expect(await asTenant(A, (tx) =>
      renewRuntimeTaskLease(tx, A, row.id, 'stream-owner'))).toBe(false);
  });

  it('keeps another tenant from leasing a guessed task', async () => {
    const row = await queued(A, 'run:1');
    expect((await lease(B, row.id, 'stolen')).outcome).toBe('missing');
  });

  it('parks an approval as a lease-free resume step and keeps later FIFO work behind it', async () => {
    const first = await queued(A, 'run:approval');
    expect((await lease(A, first.id, 'approval-lease')).outcome).toBe('leased');
    const approval = await asTenant(A, (tx) => pauseRuntimeTaskForApproval(
      tx,
      A,
      first.id,
      'approval-lease',
      {
        requestId: 'a'.repeat(32),
        tool: 'execute_code',
        message: 'Allow execute_code to fetch a public source?',
        connectionId: CONNECTION,
        chatId: 42,
        messageId: 99,
        remoteRunId: 'hermes-approval-1',
        delaySeconds: 60,
      },
    ));
    expect(approval).toMatchObject({ status: 'pending', requestId: 'a'.repeat(32) });
    const second = await queued(A, 'run:after-approval');

    const [parked] = await asOwner((sql) => sql<{
      kind: string; status: string; lease_token: string | null; remote_status: string;
    }[]>`select kind, status, lease_token, remote_status from runtime_task where id = ${first.id}`);
    expect(parked).toEqual({
      kind: 'resume',
      status: 'queued',
      lease_token: null,
      remote_status: 'waiting_for_approval',
    });
    expect((await lease(A, second.id, 'overtake')).outcome).toBe('busy');
    expect(await asTenant(A, (tx) => nextWaitingRuntimeTaskId(tx, A))).toBeNull();

    expect((await asTenant(B, (tx) => claimRuntimeApprovalDecision(tx, B, {
      approvalId: approval!.id,
      connectionId: CONNECTION,
      chatId: 42,
      messageId: 99,
      decision: 'approve',
    }))).outcome).toBe('invalid');
    expect((await asTenant(A, (tx) => claimRuntimeApprovalDecision(tx, A, {
      approvalId: approval!.id,
      connectionId: CONNECTION,
      chatId: 7,
      messageId: 99,
      decision: 'approve',
    }))).outcome).toBe('invalid');

    const claim = await asTenant(A, (tx) => claimRuntimeApprovalDecision(tx, A, {
      approvalId: approval!.id,
      connectionId: CONNECTION,
      chatId: 42,
      messageId: 99,
      decision: 'approve',
    }));
    expect(claim.outcome).toBe('claimed');
    expect(await asTenant(A, (tx) => completeRuntimeApprovalDecision(
      tx, A, first.id, approval!.id, 'approve',
    ))).toMatchObject({ status: 'approved', decision: 'approve' });
    expect((await lease(A, second.id, 'still-no-overtake')).outcome).toBe('busy');
    expect((await lease(A, first.id, 'resume-owner')).outcome).toBe('leased');
  });
});

describe('lifecycle task self-heal (re-arm on republish)', () => {
  /* Dedupe keys look like upgrade:<business>:<release> in production. */
  const upgrade = (businessId: string, dedupeKey: string) =>
    asTenant(businessId, (tx) => enqueueRuntimeTask(tx, businessId, {
      kind: 'upgrade',
      dedupeKey,
      payload: { release: '2026.09.04-2' },
    }));

  it('re-arms an exhausted upgrade task whose failure was transient', async () => {
    const first = await upgrade(A, 'upgrade:A:rel-9');
    await asOwner((sql) => sql`
      update runtime_task
         set status = 'exhausted', attempt = 8,
             last_error = 'upgrade runtime: npm registry 503 (fetch failed)'
       where id = ${first.id}`);
    const republished = await upgrade(A, 'upgrade:A:rel-9');
    expect(republished.id).toBe(first.id);
    const [row] = await asOwner((sql) => sql<{ status: string; attempt: number; lease_token: string | null }[]>`
      select status, attempt, lease_token from runtime_task where id = ${first.id}`);
    expect(row.status).toBe('queued');
    expect(row.attempt).toBe(0);
    expect(row.lease_token).toBeNull();
  });

  it('leaves exhausted tasks with deterministic errors exhausted', async () => {
    const first = await upgrade(A, 'upgrade:A:rel-8');
    await asOwner((sql) => sql`
      update runtime_task
         set status = 'exhausted', attempt = 8,
             last_error = 'bootstrap failed: patch-hermes-dependencies.mjs exit 1'
       where id = ${first.id}`);
    const republished = await upgrade(A, 'upgrade:A:rel-8');
    expect(republished.id).toBe(first.id);
    const [row] = await asOwner((sql) => sql<{ status: string }[]>`
      select status from runtime_task where id = ${first.id}`);
    expect(row.status).toBe('exhausted');
  });

  it('keeps an active (leased) task untouched on republish', async () => {
    const first = await upgrade(A, 'upgrade:A:rel-7');
    await asOwner((sql) => sql`
      update runtime_task
         set status = 'leased', lease_token = 'live-lease',
             lease_expires_at = now() + interval '1 minute'
       where id = ${first.id}`);
    const republished = await upgrade(A, 'upgrade:A:rel-7');
    expect(republished.id).toBe(first.id);
    const [row] = await asOwner((sql) => sql<{ status: string; lease_token: string }[]>`
      select status, lease_token from runtime_task where id = ${first.id}`);
    expect(row.status).toBe('leased');
    expect(row.lease_token).toBe('live-lease');
  });

  it('re-arms provision tasks too, but never interactive run tasks', async () => {
    const prov = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'provision:A:rel-6' }));
    const run = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', dedupeKey: 'run:A:1' }));
    await asOwner((sql) => sql`
      update runtime_task set status = 'exhausted', attempt = 8,
        lease_token = null, lease_expires_at = null,
        last_error = 'network timeout contacting sprite'
       where id in (${prov.id}, ${run.id})`);
    await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'provision:A:rel-6' }));
    await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', dedupeKey: 'run:A:1' }));
    const rows = await asOwner((sql) => sql<{ id: string; status: string }[]>`
      select id, status from runtime_task where id in (${prov.id}, ${run.id})`);
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    expect(byId.get(prov.id)).toBe('queued');
    expect(byId.get(run.id)).toBe('exhausted');
  });

  it('backs off exponentially for lifecycle retries, capped at 10m', () => {
    expect(lifecycleRetryDelaySeconds(0)).toBe(30);
    expect(lifecycleRetryDelaySeconds(1)).toBe(60);
    expect(lifecycleRetryDelaySeconds(2)).toBe(120);
    expect(lifecycleRetryDelaySeconds(3)).toBe(240);
    expect(lifecycleRetryDelaySeconds(4)).toBe(480);
    expect(lifecycleRetryDelaySeconds(5)).toBe(600);
    expect(lifecycleRetryDelaySeconds(9)).toBe(600);
  });
});

const queued = (businessId: string, dedupeKey: string) =>
  asTenant(businessId, (tx) => enqueueRuntimeTask(tx, businessId, {
    kind: dedupeKey.startsWith('provision') ? 'provision' : 'run',
    dedupeKey,
  }));

const lease = (businessId: string, taskId: string, token: string) =>
  asTenant(businessId, (tx) => leaseRuntimeTask(tx, businessId, taskId, token));
