import { beforeEach, describe, expect, it } from 'vitest';
import { handleArtifacts } from '../src/routes/artifacts';
import { handleRuns } from '../src/routes/runs';
import { recordArtifact } from '../src/artifacts';
import { ensureChatSession, runVisibleTo } from '../src/chat-sessions';
import { notifyOwnersWorkNeedsYou } from '../src/notifications/work';
import { finishRun, recordWork, startRun } from '../src/runs';
import { asOwner, asTenant, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const CHAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let owner: string;
let staff: string;
let cookieOwner: string;
let cookieStaff: string;

/** Just enough of R2 for a download: bytes by key. */
class FakeBucket {
  objects = new Map<string, Uint8Array>();
  async put(key: string, value: string) { this.objects.set(key, new TextEncoder().encode(value)); }
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return { key, size: bytes.byteLength, body: new Response(bytes).body, httpMetadata: {}, writeHttpMetadata() {} };
  }
  async delete(key: string) { this.objects.delete(key); }
}

beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    /* Staff seats count only on the team plan (migration 038). */
    await sql`update business set plan = 'team'`;
    const rows = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('owner@example.com', true), ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
      values (${rows[0].id}, ${A}, 'owner'), (${rows[1].id}, ${A}, 'staff')`;
    return rows;
  });
  owner = users[0].id;
  staff = users[1].id;
  cookieOwner = await signIn(owner);
  cookieStaff = await signIn(staff);
});

/** A finished run with a work record, so the task page has something to show. */
async function finishedRun(requestedBy: string, sessionId: string | null): Promise<string> {
  return asTenant(A, async (tx) => {
    if (sessionId) await ensureChatSession(tx, A, sessionId, requestedBy);
    const run = await startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'aisar-native', requestedBy, sessionId,
      triggerRef: { question: 'Prepare the digest', ...(sessionId ? { sessionId } : {}) },
    });
    await finishRun(tx, A, run.id, 'completed');
    await recordWork(tx, A, { runId: run.id, kind: 'work', objective: 'Prepare the digest', outcome: 'Digest prepared.', status: 'completed' });
    return run.id;
  });
}

async function get(path: string, cookie: string, handler = handleRuns, env = testEnv()) {
  const incoming = req('GET', path, { cookie });
  const response = await handler(incoming.request, env, incoming.url, {});
  if (!response) throw new Error('route did not match');
  return response;
}

describe('a chat and who may read its runs', () => {
  it('belongs to whoever opened it; a later turn by anyone only moves its clock', async () => {
    const first = await asTenant(A, (tx) => ensureChatSession(tx, A, CHAT, staff));
    expect(first.createdBy).toBe(staff);
    const [before] = await asTenant(A, (tx) => tx<{ last_at: Date }[]>`select last_at from chat_session where id = ${CHAT}`);
    const again = await asTenant(A, (tx) => ensureChatSession(tx, A, CHAT, owner));
    expect(again.createdBy).toBe(staff);
    const rows = await asTenant(A, (tx) => tx<{ created_by: string; last_at: Date }[]>`
      select created_by, last_at from chat_session where id = ${CHAT}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].created_by).toBe(staff);
    expect(rows[0].last_at.getTime()).toBeGreaterThan(before.last_at.getTime());
  });

  it('stamps the run with its chat, and reads a run with no chat as everyone\'s', async () => {
    const privateRun = await finishedRun(staff, CHAT);
    const sharedRun = await finishedRun(owner, null);
    const rows = await asTenant(A, (tx) => tx<{ id: string; session_id: string | null }[]>`
      select id, session_id from run order by created_at`);
    expect(rows).toEqual([{ id: privateRun, session_id: CHAT }, { id: sharedRun, session_id: null }]);
    await asTenant(A, async (tx) => {
      expect(await runVisibleTo(tx, A, privateRun, staff)).toBe(true);
      expect(await runVisibleTo(tx, A, privateRun, owner)).toBe(false);
      expect(await runVisibleTo(tx, A, sharedRun, staff)).toBe(true);
      expect(await runVisibleTo(tx, A, 'ffffffff-ffff-4fff-8fff-ffffffffffff', staff)).toBe(false);
    });
  });

  it('an owner notification opens only the shared summary, with a working review decision', async () => {
    const runId = await finishedRun(staff, CHAT);
    await asTenant(A, async (tx) => {
      await tx`update work_record set status = 'needs_review' where run_id = ${runId}`;
      await notifyOwnersWorkNeedsYou(tx, A, { runId, status: 'needs_review', objective: 'Prepare the digest' });
    });
    const [notification] = await asTenant(A, (tx) => tx<{ url: string }[]>`select url from push_outbox where user_id = ${owner}`);
    expect(notification.url).toBe(`/app?view=work&review=${runId}`);
    const summary = await get(`/api/runs/${runId}/review-summary`, cookieOwner);
    expect(await jsonOf(summary)).toEqual({ ok: true, runId, objective: 'Prepare the digest', text: 'Digest prepared.',
      status: 'completed', taskStatus: 'needs_review', summaryOnly: true, pending: false });
    expect((await get(`/api/runs/${runId}`, cookieOwner)).status).toBe(404);
    expect((await get(`/api/runs/${runId}/trace`, cookieOwner)).status).toBe(404);
    expect((await get(`/api/runs/${runId}/review-summary`, cookieStaff)).status).toBe(403);
    expect((await get('/api/runs/ffffffff-ffff-4fff-8fff-ffffffffffff/review-summary', cookieOwner)).status).toBe(404);
    const incoming = req('POST', `/api/runs/${runId}/review`, { cookie: cookieOwner, body: { decision: 'confirm' } });
    incoming.request.headers.set('Origin', 'https://app.test');
    expect((await handleRuns(incoming.request, testEnv(), incoming.url, { 'Access-Control-Allow-Origin': 'https://app.test' }))?.status).toBe(200);
    expect(await jsonOf(await get(`/api/runs/${runId}/review-summary`, cookieOwner))).toMatchObject({ taskStatus: 'completed' });
  });

  it('shows the task page and the trace only to the person whose chat it is', async () => {
    const privateRun = await finishedRun(staff, CHAT);
    const sharedRun = await finishedRun(owner, null);
    expect((await get(`/api/runs/${privateRun}`, cookieStaff)).status).toBe(200);
    expect((await get(`/api/runs/${privateRun}`, cookieOwner)).status).toBe(404);
    expect((await get(`/api/runs/${privateRun}/trace`, cookieStaff)).status).toBe(200);
    expect((await get(`/api/runs/${privateRun}/trace`, cookieOwner)).status).toBe(404);
    expect((await get(`/api/runs/${sharedRun}`, cookieStaff)).status).toBe(200);
    expect((await get(`/api/runs/${sharedRun}/trace`, cookieStaff)).status).toBe(200);
  });

  it('lists a colleague\'s private work in Activity as something that cannot be opened', async () => {
    await finishedRun(staff, CHAT);
    await finishedRun(owner, null);
    const ownerView = await jsonOf<{ work: { canOpen?: boolean; requestedBy?: string | null }[] }>(await get('/api/runs/activity', cookieOwner));
    expect(ownerView.work.map((w) => w.canOpen)).toEqual([true, false]);
    expect(ownerView.work.map((w) => w.requestedBy)).toEqual(['owner@example.com', 'staff@example.com']);
    const staffView = await jsonOf<{ work: { canOpen?: boolean }[] }>(await get('/api/runs/activity', cookieStaff));
    expect(staffView.work.map((w) => w.canOpen)).toEqual([true, true]);
  });

  it('keeps a private chat\'s files out of a colleague\'s Files and downloads', async () => {
    const privateRun = await finishedRun(staff, CHAT);
    const sharedRun = await finishedRun(owner, null);
    const bucket = new FakeBucket();
    await bucket.put(`${A}/${privateRun}/${P1}/private.md`, 'secret');
    await bucket.put(`${A}/${sharedRun}/${S1}/shared.md`, 'shared');
    await asTenant(A, async (tx) => {
      await recordArtifact(tx, A, { id: P1, runId: privateRun, name: 'private.md', contentType: 'text/markdown', size: 6, r2Key: `${A}/${privateRun}/${P1}/private.md` });
      await recordArtifact(tx, A, { id: S1, runId: sharedRun, name: 'shared.md', contentType: 'text/markdown', size: 6, r2Key: `${A}/${sharedRun}/${S1}/shared.md` });
    });
    const env = testEnv({ ARTIFACTS: bucket });
    const ownerList = await jsonOf<{ artifacts: { name: string }[] }>(await get('/api/artifacts', cookieOwner, handleArtifacts, env));
    expect(ownerList.artifacts.map((a) => a.name)).toEqual(['shared.md']);
    const staffList = await jsonOf<{ artifacts: { name: string }[] }>(await get('/api/artifacts', cookieStaff, handleArtifacts, env));
    expect(staffList.artifacts.map((a) => a.name)).toEqual(['shared.md', 'private.md']);
    expect((await get(`/api/artifacts/${P1}`, cookieOwner, handleArtifacts, env)).status).toBe(404);
    expect((await get(`/api/artifacts/${P1}`, cookieStaff, handleArtifacts, env)).status).toBe(200);
  });
});
