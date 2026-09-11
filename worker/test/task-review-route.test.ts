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
async function confirm(session = cookie, origin = 'https://jentera.ai', target = runId) {
  const request = new Request(`https://api.test/api/runs/${target}/review`, { method: 'POST',
    headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'confirm' }) });
  return (await handleRuns(request, testEnv(), new URL(request.url), { 'Access-Control-Allow-Origin': 'https://jentera.ai' }))!;
}
it('confirms reviewed work, updates the counter and records the owner decision', async () => {
  expect((await confirm()).status).toBe(200);
  await asTenant(business, async (tx) => {
    expect(await homeCounters(tx)).toMatchObject({ handled: 1, needsYou: 0 });
    expect(await taskAssessmentForRun(tx, business, runId)).toMatchObject({ status: 'completed', source: 'owner.review' });
  });
  expect((await confirm()).status).toBe(409);
});
it('rejects staff, foreign origins and unknown runs', async () => {
  expect((await confirm(staff)).status).toBe(403);
  expect((await confirm(cookie, 'https://other.test')).status).toBe(403);
  expect((await confirm(cookie, undefined, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).status).toBe(409);
});
it('cannot confirm work still waiting for input or execution', async () => {
  await asTenant(business, (tx) => tx`update work_record set status = 'needs_input' where run_id = ${runId}`);
  expect((await confirm()).status).toBe(409);
  await asTenant(business, async (tx) => {
    await tx`update work_record set status = 'needs_review' where run_id = ${runId}`;
    await tx`update run set status = 'needs_approval' where id = ${runId}`;
  });
  expect((await confirm()).status).toBe(409);
});
