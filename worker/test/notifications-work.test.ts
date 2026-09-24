import { beforeEach, describe, expect, it } from 'vitest';
import {
  FINISHED_PUSH_AFTER_SECONDS,
  notifyOwnersApprovalRequested,
  notifyOwnersWorkNeedsYou,
  notifyRequesterWorkFinished,
} from '../src/notifications/work';
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
    // Multi-row fixture inserts share created_at; the database does not
    // promise insertion order. Assert the exact recipients instead.
    expect((await asTenant(A, (tx) => ownersOf(tx, A))).sort()).toEqual([ids.owner, ids.partner].sort());
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
    expect(await asTenant(A, (tx) => notifyOwnersApprovalRequested(tx, A, { runId, objective: 'Email the supplier' }))).toBe(2);
    const [first] = await rows();
    expect(first).toMatchObject({ kind: 'approval_requested', title: 'Email the supplier — approval needed' });
    expect(first.body).toBe('aisha asked for this. Open the task to approve or decline.');
  });
});

const SOLO = '33333333-3333-4333-8333-333333333333';

const soloOwner = () => asOwner(async (sql) => {
  await sql`insert into business (id, name, playbook_key) values (${SOLO}, 'Kedai Solo', 'retail')`;
  const [user] = await sql<{ id: string }[]>`
    insert into app_user (email, email_verified) values ('solo@example.com', true) returning id`;
  await sql`insert into membership (user_id, business_id, role) values (${user.id}, ${SOLO}, 'owner')`;
  return user.id;
});

const soloRun = (requestedBy: string) => asTenant(SOLO, async (tx) => (await startRun(tx, SOLO, {
  kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', requestedBy, triggerRef: { question: 'Chase the late invoices' },
})).id);

const soloRows = () => asTenant(SOLO, (tx) => tx<{ recipient_user_id: string; kind: string; title: string; body: string }[]>`
  select recipient_user_id, kind, title, body from notification order by created_at`);

const age = (business: string, runId: string, seconds: number) => asOwner((sql) => sql`
  update run set created_at = now() - make_interval(secs => ${seconds})
   where business_id = ${business} and id = ${runId}`);

describe('the person who asked in the app is told too', () => {
  it('tells a solo owner that an action they asked for awaits their approval', async () => {
    const owner = await soloOwner();
    const runId = await soloRun(owner);
    expect(await asTenant(SOLO, (tx) => notifyOwnersApprovalRequested(tx, SOLO, {
      runId, objective: 'Email the supplier', channel: 'app',
    }))).toBe(1);
    const [row] = await soloRows();
    expect(row).toMatchObject({ recipient_user_id: owner, kind: 'approval_requested', title: 'Email the supplier — approval needed' });
    expect(row.body).toBe('You asked for this. Open the task to approve or decline; it will not wait long.');
    expect(await asTenant(SOLO, (tx) => tx`select 1 from push_outbox`)).toHaveLength(1);
  });

  it('tells the asking owner and the other owner, each once', async () => {
    const runId = await run(ids.owner);
    const notify = () => asTenant(A, (tx) => notifyOwnersApprovalRequested(tx, A, {
      runId, objective: 'Email the supplier', channel: 'app',
    }));
    expect(await notify()).toBe(2);
    expect(await notify()).toBe(0);
    expect((await rows()).map((r) => r.recipient_user_id).sort()).toEqual([ids.owner, ids.partner].sort());
  });

  it('does not ask staff to approve what only an owner may decide', async () => {
    const runId = await run(ids.aisha);
    expect(await asTenant(A, (tx) => notifyOwnersApprovalRequested(tx, A, {
      runId, objective: 'Email the supplier', channel: 'app',
    }))).toBe(2);
    expect((await rows()).map((r) => r.recipient_user_id)).not.toContain(ids.aisha);
  });

  it('leaves Telegram and routine runs to their own channels', async () => {
    const owner = await soloOwner();
    for (const channel of ['telegram', 'workspace', undefined]) {
      const runId = await soloRun(owner);
      expect(await asTenant(SOLO, (tx) => notifyOwnersApprovalRequested(tx, SOLO, { runId, objective: 'Pay the bill', channel }))).toBe(0);
      expect(await asTenant(SOLO, (tx) => notifyOwnersWorkNeedsYou(tx, SOLO, {
        runId, status: 'needs_input', objective: 'Pay the bill', channel,
      }))).toBe(0);
    }
    expect(await soloRows()).toHaveLength(0);
  });

  it('tells a solo owner that their task needs input', async () => {
    const owner = await soloOwner();
    const runId = await soloRun(owner);
    expect(await asTenant(SOLO, (tx) => notifyOwnersWorkNeedsYou(tx, SOLO, {
      runId, status: 'needs_input', objective: 'Renew the licence', channel: 'app',
    }))).toBe(1);
    const [row] = await soloRows();
    expect(row).toMatchObject({ recipient_user_id: owner, kind: 'work_needs_you', title: 'Renew the licence — needs you' });
    expect(row.body).toBe('You asked for this. Jentera needs details or authorisation only you can give.');
  });

  it('tells staff when their own task needs input, but not to review what only an owner confirms', async () => {
    const input = await run(ids.aisha);
    expect(await asTenant(A, (tx) => notifyOwnersWorkNeedsYou(tx, A, {
      runId: input, status: 'needs_input', objective: 'Count the stock', channel: 'app',
    }))).toBe(3);
    const review = await run(ids.aisha);
    expect(await asTenant(A, (tx) => notifyOwnersWorkNeedsYou(tx, A, {
      runId: review, status: 'needs_review', objective: 'Draft the menu', channel: 'app',
    }))).toBe(2);
  });
});

describe('telling the person who asked that a long task finished', () => {
  it('tells them a work task finished once it took long enough to have put the phone down', async () => {
    const owner = await soloOwner();
    const runId = await soloRun(owner);
    await age(SOLO, runId, FINISHED_PUSH_AFTER_SECONDS + 5);
    const finished = () => asTenant(SOLO, (tx) => notifyRequesterWorkFinished(tx, SOLO, {
      runId, status: 'completed', objective: 'Chase the late invoices', channel: 'app', kind: 'work',
    }));
    expect(await finished()).toBe(1);
    expect(await finished()).toBe(0);
    const [row] = await soloRows();
    expect(row).toMatchObject({
      recipient_user_id: owner, kind: 'work_finished',
      title: 'Chase the late invoices — done', body: 'Open it to see the result.',
    });
  });

  it('says so when the task could not finish', async () => {
    const owner = await soloOwner();
    const runId = await soloRun(owner);
    await age(SOLO, runId, FINISHED_PUSH_AFTER_SECONDS + 5);
    expect(await asTenant(SOLO, (tx) => notifyRequesterWorkFinished(tx, SOLO, {
      runId, status: 'failed', objective: 'Chase the late invoices', channel: 'app', kind: 'work',
    }))).toBe(1);
    expect((await soloRows())[0]).toMatchObject({
      title: 'Chase the late invoices — could not finish', body: 'Open it to see what happened.',
    });
  });

  it('stays quiet for a quick task, a chat reply, or a run from elsewhere', async () => {
    const owner = await soloOwner();
    const quick = await soloRun(owner);
    await age(SOLO, quick, FINISHED_PUSH_AFTER_SECONDS - 30);
    const chat = await soloRun(owner);
    await age(SOLO, chat, FINISHED_PUSH_AFTER_SECONDS + 5);
    const telegram = await soloRun(owner);
    await age(SOLO, telegram, FINISHED_PUSH_AFTER_SECONDS + 5);
    const cases = [
      { runId: quick, channel: 'app', kind: 'work' },
      { runId: chat, channel: 'app', kind: 'conversation' },
      { runId: telegram, channel: 'telegram', kind: 'work' },
    ] as const;
    for (const c of cases) {
      expect(await asTenant(SOLO, (tx) => notifyRequesterWorkFinished(tx, SOLO, {
        ...c, status: 'completed', objective: 'Chase the late invoices',
      }))).toBe(0);
    }
    expect(await soloRows()).toHaveLength(0);
  });

  it('tells only the person who asked, not the other owners', async () => {
    const runId = await run(ids.aisha);
    await age(A, runId, FINISHED_PUSH_AFTER_SECONDS + 5);
    expect(await asTenant(A, (tx) => notifyRequesterWorkFinished(tx, A, {
      runId, status: 'completed', objective: 'Count the stock', channel: 'app', kind: 'work',
    }))).toBe(1);
    expect((await rows()).map((r) => r.recipient_user_id)).toEqual([ids.aisha]);
  });
});
