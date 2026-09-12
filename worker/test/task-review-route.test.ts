import { beforeEach, expect, it } from 'vitest';
import { handleRuns } from '../src/routes/runs';
import { append, finishRun, homeCounters, recordWork, startRun } from '../src/runs';
import { taskAssessmentForRun } from '../src/task-outcome';
import { asOwner, asTenant, signIn, testEnv, truncateAll } from './harness';

const business = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let cookie: string;
let staff: string;
let runId: string;
beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${business}, 'Review test', 'restaurant')`;
    const rows = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('review@example.com', true), ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values
      (${rows[0].id}, ${business}, 'owner'), (${rows[1].id}, ${business}, 'staff')`;
    return rows;
  });
  cookie = await signIn(users[0].id);
  staff = await signIn(users[1].id);
  runId = await asTenant(business, async (tx) => {
    const run = await startRun(tx, business, { kind: 'ask', runtime: 'hermes-sprite', triggerShape: 'owner.ask' });
    await finishRun(tx, business, run.id, 'completed');
    await append(tx, business, run.id, 'outcome.observed', { kind: 'work', status: 'needs_review', assessmentVersion: 1 });
    await recordWork(tx, business, { runId: run.id, kind: 'work', objective: 'Prepare report', status: 'needs_review' });
    return run.id;
  });
});
async function review(decision: string, over: { session?: string; origin?: string; target?: string } = {}) {
  const request = new Request(`https://api.test/api/runs/${over.target ?? runId}/review`, { method: 'POST',
    headers: { Cookie: over.session ?? cookie, Origin: over.origin ?? 'https://jentera.ai', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }) });
  return (await handleRuns(request, testEnv(), new URL(request.url), { 'Access-Control-Allow-Origin': 'https://jentera.ai' }))!;
}
const confirm = (session?: string, origin?: string, target?: string) => review('confirm', { session, origin, target });
const waitingOnOwner = (status: string) =>
  asTenant(business, (tx) => tx`update work_record set status = ${status} where run_id = ${runId}`);

it('confirms reviewed work, updates the counter and records the owner decision', async () => {
  expect((await confirm()).status).toBe(200);
  await asTenant(business, async (tx) => {
    expect(await homeCounters(tx)).toMatchObject({ handled: 1, needsYou: 0 });
    expect(await taskAssessmentForRun(tx, business, runId)).toMatchObject({ status: 'completed', source: 'owner.review' });
  });
  expect((await confirm()).status).toBe(409);
});
it('rejects staff, foreign origins, unknown runs and decisions it does not know', async () => {
  expect((await confirm(staff)).status).toBe(403);
  expect((await confirm(cookie, 'https://other.test')).status).toBe(403);
  expect((await confirm(cookie, undefined, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).status).toBe(409);
  expect((await review('maybe')).status).toBe(400);
  await asTenant(business, async (tx) => {
    expect(await taskAssessmentForRun(tx, business, runId)).toMatchObject({ status: 'needs_review' });
  });
});
it('lets the owner mark work that is waiting on them as done', async () => {
  for (const status of ['needs_input', 'blocked']) {
    await waitingOnOwner(status);
    expect((await confirm()).status).toBe(200);
    await asTenant(business, async (tx) => {
      expect(await homeCounters(tx)).toMatchObject({ handled: 1, needsYou: 0 });
      const [record] = await tx<{ status: string }[]>`select status from work_record where run_id = ${runId}`;
      expect(record.status).toBe('completed');
    });
  }
  await asTenant(business, async (tx) => {
    expect(await taskAssessmentForRun(tx, business, runId)).toMatchObject({ status: 'completed', source: 'owner.review', decision: 'confirm' });
  });
});
it('lets the owner dismiss work that is no longer needed, which never counts as handled', async () => {
  for (const status of ['needs_input', 'needs_review', 'blocked']) {
    await waitingOnOwner(status);
    expect((await review('dismiss')).status).toBe(200);
    await asTenant(business, async (tx) => {
      expect(await homeCounters(tx)).toMatchObject({ handled: 0, needsYou: 0 });
      const [record] = await tx<{ status: string }[]>`select status from work_record where run_id = ${runId}`;
      expect(record.status).toBe('cancelled');
    });
  }
  await asTenant(business, async (tx) => {
    expect(await taskAssessmentForRun(tx, business, runId)).toMatchObject({ status: 'cancelled', source: 'owner.review', decision: 'dismiss' });
  });
  /* Settled is settled: a second decision finds nothing waiting. */
  expect((await review('dismiss')).status).toBe(409);
  expect((await confirm()).status).toBe(409);
});
it('cannot confirm or dismiss work whose run is still executing', async () => {
  await asTenant(business, (tx) => tx`update run set status = 'needs_approval' where id = ${runId}`);
  expect((await confirm()).status).toBe(409);
  expect((await review('dismiss')).status).toBe(409);
  await asTenant(business, async (tx) => {
    const [record] = await tx<{ status: string }[]>`select status from work_record where run_id = ${runId}`;
    expect(record.status).toBe('needs_review');
  });
});
