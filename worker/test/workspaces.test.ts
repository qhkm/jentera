import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimRuntime, markRuntimeReady } from '../src/agent-runtime';
import type { Env } from '../src/env';
import { handleChats } from '../src/routes/chats';
import { handleRuns } from '../src/routes/runs';
import { handleWorkspaces } from '../src/routes/workspaces';
import { ensureChatSession, runVisibleTo } from '../src/chat-sessions';
import { finishRun, recordWork, startRun } from '../src/runs';
import { asOwner, asTenant, jsonOf, req, sendFake, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const RELEASE = '2026.08.28-4';
const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };
let ids: Record<string, string>;
let cookies: Record<string, string>;

beforeEach(async () => {
  await truncateAll();
  ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, plan) values (${A}, 'Kitakod', 'restaurant', 'team')`;
    const rows = await sql<{ id: string; email: string }[]>`insert into app_user (email, email_verified) values
      ('owner@example.com', true), ('aisha@example.com', true), ('ravi@example.com', true) returning id, email`;
    const by = Object.fromEntries(rows.map((r) => [r.email.split('@')[0], r.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${by.owner}, ${A}, 'owner'), (${by.aisha}, ${A}, 'staff'), (${by.ravi}, ${A}, 'staff')`;
    return by;
  });
  cookies = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, await signIn(id)])));
});

function env(over: Record<string, unknown> = {}): Env {
  return testEnv({ RUNTIME_RELEASE: RELEASE, RUNTIME_EXECUTION_ENABLED: 'true', AISAR_MODEL_NAME: 'deepseek/test', RUNTIME_QUEUE: { send: sendFake() }, ...over });
}

async function call(handler: typeof handleWorkspaces, method: string, path: string, cookie: string, body?: unknown) {
  const incoming = req(method, path, { cookie, body });
  incoming.request.headers.set('Origin', 'https://jentera.ai');
  const response = await handler(incoming.request, env(), incoming.url, cors);
  if (!response) throw new Error(`${path} did not match`);
  return response;
}
const ws = (method: string, path: string, cookie: string, body?: unknown) => call(handleWorkspaces, method, path, cookie, body);
const chats = (method: string, path: string, cookie: string) => call(handleChats, method, path, cookie);

async function createWorkspace(name: string, memberIds: string[] = []): Promise<string> {
  const response = await ws('POST', '/api/workspaces', cookies.owner, { name, memberIds });
  expect(response.status).toBe(201);
  return (await jsonOf<{ workspace: { id: string } }>(response)).workspace.id;
}

/** A finished run in a chat, with a work record so Activity and the task page have something. */
async function finishedTurn(userId: string, sessionId: string, question: string, workspaceId: string | null = null): Promise<string> {
  return asTenant(A, async (tx) => {
    await ensureChatSession(tx, A, sessionId, userId, { workspaceId, title: question });
    const run = await startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'aisar-native', requestedBy: userId, sessionId,
      triggerRef: { question, sessionId },
    });
    await finishRun(tx, A, run.id, 'completed');
    await recordWork(tx, A, { runId: run.id, kind: 'work', objective: question, outcome: `Done: ${question}`, status: 'completed' });
    return run.id;
  });
}

describe('workspaces: shared chats inside a business', () => {
  it('lets the owner create one with members; everyone sees the ones they are in, the owner sees all', async () => {
    const id = await createWorkspace('Marketing', [ids.aisha]);
    const mine = await jsonOf<{ workspaces: { id: string; name: string; member: boolean; members: { email: string }[] }[] }>(
      await ws('GET', '/api/workspaces', cookies.aisha));
    expect(mine.workspaces).toEqual([expect.objectContaining({ id, name: 'Marketing', member: true })]);
    expect(mine.workspaces[0].members.map((m) => m.email).sort()).toEqual(['aisha@example.com', 'owner@example.com']);
    const ravi = await jsonOf<{ workspaces: unknown[] }>(await ws('GET', '/api/workspaces', cookies.ravi));
    expect(ravi.workspaces).toEqual([]);
    await ws('DELETE', `/api/workspaces/${id}/members/${ids.owner}`, cookies.owner);
    const owner = await jsonOf<{ workspaces: { member: boolean }[] }>(await ws('GET', '/api/workspaces', cookies.owner));
    expect(owner.workspaces).toEqual([expect.objectContaining({ id, member: false })]);
  });

  it('is owner-only to manage and needs the team plan', async () => {
    expect((await ws('POST', '/api/workspaces', cookies.aisha, { name: 'Ops' })).status).toBe(403);
    expect((await ws('POST', '/api/workspaces', cookies.owner, { name: '' })).status).toBe(400);
    const id = await createWorkspace('Ops');
    expect((await ws('POST', `/api/workspaces/${id}/members`, cookies.aisha, { userId: ids.aisha })).status).toBe(403);
    expect((await ws('POST', `/api/workspaces/${id}/members`, cookies.owner, { userId: '99999999-9999-4999-8999-999999999999' })).status).toBe(404);
    expect((await ws('POST', `/api/workspaces/${id}/members`, cookies.owner, { userId: ids.ravi })).status).toBe(200);
    expect((await ws('POST', `/api/workspaces/${id}/members`, cookies.owner, { userId: ids.ravi })).status).toBe(200);
    await asOwner((sql) => sql`update business set plan = 'pro' where id = ${A}`);
    expect((await ws('POST', '/api/workspaces', cookies.owner, { name: 'Later' })).status).toBe(402);
    expect((await ws('GET', '/api/workspaces', cookies.owner)).status).toBe(200);
  });

  it('opens a chat inside a workspace only for its members, and the chat stays there', async () => {
    const id = await createWorkspace('Marketing', [ids.aisha]);
    await asTenant(A, (tx) => claimRuntime(env(), tx, A, {
      provider: 'fly-sprite', providerName: 'test-ws', release: RELEASE, runnerKey: 'runner-test-key', hermesApiKey: 'hermes-test-key',
    }));
    await asTenant(A, (tx) => markRuntimeReady(tx, A, RELEASE, 'v1'));
    const chat = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const ask = (cookie: string, sessionId: string, workspaceId?: string) => call(handleRuns as never, 'POST', '/api/runs/ask', cookie, {
      question: 'Plan the launch campaign', requestId: crypto.randomUUID(), mode: 'work', sessionId, ...(workspaceId ? { workspaceId } : {}),
    });
    expect((await ask(cookies.ravi, chat, id)).status).toBe(403);
    expect((await ask(cookies.aisha, chat, id)).status).toBe(202);
    const rows = await asTenant(A, (tx) => tx<{ workspace_id: string | null; created_by: string; title: string | null }[]>`
      select workspace_id, created_by, title from chat_session where id = ${chat}`);
    expect(rows).toEqual([{ workspace_id: id, created_by: ids.aisha, title: 'Plan the launch campaign' }]);
    /* A later turn from another member continues the same chat; it cannot move it. */
    expect((await ask(cookies.owner, chat)).status).toBe(202);
    const after = await asTenant(A, (tx) => tx<{ workspace_id: string | null; created_by: string }[]>`
      select workspace_id, created_by from chat_session where id = ${chat}`);
    expect(after).toEqual([{ workspace_id: id, created_by: ids.aisha }]);
  });

  it('lets every member read and continue the workspace\'s runs, and nobody else', async () => {
    const id = await createWorkspace('Marketing', [ids.aisha]);
    const shared = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const runId = await finishedTurn(ids.aisha, shared, 'Draft the campaign brief', id);
    const privateRun = await finishedTurn(ids.ravi, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Count the stock');
    await asTenant(A, async (tx) => {
      expect(await runVisibleTo(tx, A, runId, ids.owner)).toBe(true);
      expect(await runVisibleTo(tx, A, runId, ids.aisha)).toBe(true);
      expect(await runVisibleTo(tx, A, runId, ids.ravi)).toBe(false);
      expect(await runVisibleTo(tx, A, privateRun, ids.owner)).toBe(false);
    });
    expect((await call(handleRuns as never, 'GET', `/api/runs/${runId}`, cookies.owner)).status).toBe(200);
    expect((await call(handleRuns as never, 'GET', `/api/runs/${runId}`, cookies.ravi)).status).toBe(404);
    const activity = await jsonOf<{ work: { objective: string; canOpen: boolean }[] }>(
      await call(handleRuns as never, 'GET', '/api/runs/activity', cookies.owner));
    expect(activity.work.map((w) => [w.objective, w.canOpen])).toEqual([['Count the stock', false], ['Draft the campaign brief', true]]);
  });

  it('lists a workspace\'s chats with their turns to members, newest first', async () => {
    const id = await createWorkspace('Marketing', [ids.aisha]);
    const first = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await finishedTurn(ids.aisha, first, 'Draft the campaign brief', id);
    await finishedTurn(ids.owner, first, 'Make it shorter', id);
    await finishedTurn(ids.owner, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Price list for Q4', id);
    const list = await jsonOf<{ chats: { id: string; title: string; createdBy: string; turns: number }[] }>(
      await chats('GET', `/api/chats?workspaceId=${id}`, cookies.aisha));
    expect(list.chats.map((c) => [c.title, c.createdBy, c.turns])).toEqual([
      ['Price list for Q4', 'owner@example.com', 1], ['Draft the campaign brief', 'aisha@example.com', 2],
    ]);
    expect((await chats('GET', `/api/chats?workspaceId=${id}`, cookies.ravi)).status).toBe(404);
    const one = await jsonOf<{ chat: { id: string; workspaceId: string; turns: { question: string; text: string | null; requestedBy: string; status: string }[] } }>(
      await chats('GET', `/api/chats/${first}`, cookies.owner));
    expect(one.chat.workspaceId).toBe(id);
    expect(one.chat.turns.map((turn) => [turn.question, turn.text, turn.requestedBy, turn.status])).toEqual([
      ['Draft the campaign brief', 'Done: Draft the campaign brief', 'aisha@example.com', 'completed'],
      ['Make it shorter', 'Done: Make it shorter', 'owner@example.com', 'completed'],
    ]);
    expect((await chats('GET', `/api/chats/${first}`, cookies.ravi)).status).toBe(404);
    /* A private chat is its opener's alone, on this route as on the others. */
    const mine = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await finishedTurn(ids.ravi, mine, 'Count the stock');
    expect((await chats('GET', `/api/chats/${mine}`, cookies.ravi)).status).toBe(200);
    expect((await chats('GET', `/api/chats/${mine}`, cookies.owner)).status).toBe(404);
  });
});
vi.mock('../src/email', () => ({ sendNotice: vi.fn(async () => true), sendMagicLink: vi.fn(async () => {}) }));
