import { beforeEach, describe, expect, it } from 'vitest';
import { notifyOwnersApprovalRequested, notifyOwnersWorkNeedsYou } from '../src/notifications/work';
import { ownersOf } from '../src/notifications/recipients';
import { startRun } from '../src/runs';
import { asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let ids: Record<string, string>;

beforeEach(async () => {
  await truncateAll();
  ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, plan) values (${A}, 'Kitakod', 'restaurant', 'team')`;
    const rows = await sql<{ id: string; email: string }[]>`insert into app_user (email, email_verified) values
      ('owner@example.com', true), ('partner@example.com', true), ('aisha@example.com', true) returning id, email`;
    const by = Object.fromEntries(rows.map((r) => [r.email.split('@')[0], r.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${by.owner}, ${A}, 'owner'), (${by.partner}, ${A}, 'owner'), (${by.aisha}, ${A}, 'staff')`;
    return by;
  });
});

const run = (requestedBy: string) => asTenant(A, async (tx) => (await startRun(tx, A, {
  kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', requestedBy, triggerRef: { question: 'Prepare the supplier list' },
})).id);

const rows = () => asTenant(A, (tx) => tx<{ recipient_user_id: string; kind: string; title: string; body: string; run_id: string }[]>`
  select recipient_user_id, kind, title, body, run_id from notification order by created_at, recipient_user_id`);

describe('who is told about a colleague\'s work', () => {
  it('names every owner but the one who asked', async () => {
    expect(await asTenant(A, (tx) => ownersOf(tx, A))).toEqual([ids.owner, ids.partner]);
    expect(await asTenant(A, (tx) => ownersOf(tx, A, { except: ids.owner }))).toEqual([ids.partner]);
  });

  it('tells the owners when a staff member\'s task ends waiting on them, once', async () => {
    const runId = await run(ids.aisha);
    const sent = await asTenant(A, (tx) => notifyOwnersWorkNeedsYou(tx, A, { runId, status: 'needs_review', objective: 'Prepare the supplier list' }));
    expect(sent).toBe(2);
    const again = await asTenant(A, (tx) => notifyOwnersWorkNeedsYou(tx, A, { runId, status: 'needs_review', objective: 'Prepare the supplier list' }));
    expect(again).toBe(0);
    const all = await rows();
    expect(all.map((r) => r.recipient_user_id).sort()).toEqual([ids.owner, ids.partner].sort());
    expect(all[0]).toMatchObject({ kind: 'work_needs_you', title: 'Prepare the supplier list — needs you', run_id: runId });
    expect(all[0].body).toMatch(/^aisha asked for this\. The result is ready/);
    const queued = await asTenant(A, (tx) => tx<{ user_id: string }[]>`select user_id from push_outbox`);
    expect(queued).toHaveLength(2);
  });

  it('tells the other owner, not the asking owner, and nobody when a task simply completed', async () => {
    const runId = await run(ids.owner);
    expect(await asTenant(A, (tx) => notifyOwnersWorkNeedsYou(tx, A, { runId, status: 'needs_input', objective: 'Renew the licence' }))).toBe(1);
    expect((await rows()).map((r) => r.recipient_user_id)).toEqual([ids.partner]);
    const done = await run(ids.aisha);
    expect(await asTenant(A, (tx) => notifyOwnersWorkNeedsYou(tx, A, { runId: done, status: 'completed', objective: 'Reply to a customer' }))).toBe(0);
  });

  it('tells the owners when a colleague\'s action awaits approval', async () => {
    const runId = await run(ids.aisha);
    expect(await asTenant(A, (tx) => notifyOwnersApprovalRequested(tx, A, { runId, objective: 'Email the supplier', summary: 'Send the revised order to Ali.' }))).toBe(2);
    const [first] = await rows();
    expect(first).toMatchObject({ kind: 'approval_requested', title: 'Email the supplier — approval needed' });
    expect(first.body).toBe('aisha asked for this. Send the revised order to Ali.');
  });
});
