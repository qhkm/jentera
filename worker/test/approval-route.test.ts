import { beforeEach, describe, expect, it } from 'vitest';
import { handleRuntime } from '../src/routes/runtime';
import { pauseRuntimeTaskForApproval } from '../src/runtime/tasks';
import type { Env } from '../src/env';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://jentera.ai';
const REQUEST = 'a'.repeat(32);

let ownerCookie = '';
let staffCookie = '';

beforeEach(async () => {
  await truncateAll();
  let ownerId = '';
  let staffId = '';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
              values (${A}, 'Alpha', 'restaurant', true)`;
    const [owner] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    const [staff] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${owner.id}, ${A}, 'owner'), (${staff.id}, ${A}, 'staff')`;
    ownerId = owner.id;
    staffId = staff.id;
  });
  ownerCookie = await signIn(ownerId);
  staffCookie = await signIn(staffId);
});

/** A web approval parked on a leased task, as the consumer now does. */
async function parkWebApproval(): Promise<string> {
  const taskId = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  await asOwner((sql) => sql`
    insert into runtime_task (id, business_id, kind, status, payload, dedupe_key,
                              lease_token, lease_expires_at, lease_heartbeat_at, attempt)
    values (${taskId}, ${A}, 'run', 'leased', '{}'::jsonb, ${taskId},
            ${leaseToken}, now() + interval '5 minutes', now(), 1)`);
  const approval = await asTenant(A, (tx) =>
    pauseRuntimeTaskForApproval(tx, A, taskId, leaseToken, {
      requestId: REQUEST,
      tool: 'terminal',
      message: 'npm install -g wrangler',
      remoteRunId: 'hermes-run-1',
      delaySeconds: 600,
    }));
  return approval!.id;
}

async function call(
  method: string,
  path: string,
  opts: { cookie?: string; origin?: string | null; contentType?: string; body?: unknown } = {},
) {
  const { request, url } = req(method, path, { cookie: opts.cookie });
  const headers = new Headers(request.headers);
  if (opts.origin !== null) headers.set('Origin', opts.origin ?? ORIGIN);
  else headers.delete('Origin');
  if (opts.contentType !== undefined) headers.set('Content-Type', opts.contentType);
  const shaped = new Request(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const env = testEnv({ ALLOWED_ORIGINS: ORIGIN }) as Env;
  const response = await handleRuntime(shaped, env, url, {
    'Access-Control-Allow-Origin': ORIGIN,
  });
  if (!response) throw new Error('runtime route did not match');
  return response;
}

describe('reading what the owner is being asked', () => {
  it('shows the question to any member, without the runner binding', async () => {
    /* Seeing the question is not deciding it, so staff may read. requestId is
       what the runner binds a decision to and no surface needs it. */
    const id = await parkWebApproval();
    for (const cookie of [ownerCookie, staffCookie]) {
      const response = await call('GET', `/api/runtime/approvals/${id}`, { cookie });
      expect(response.status).toBe(200);
      const body = await response.json() as { approval: Record<string, unknown> };
      expect(body.approval).toMatchObject({
        id, tool: 'terminal', message: 'npm install -g wrangler',
        status: 'pending', surface: 'web',
      });
      expect(body.approval.requestId).toBeUndefined();
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  it('refuses an unknown id and an unauthenticated reader', async () => {
    expect((await call('GET', `/api/runtime/approvals/${crypto.randomUUID()}`,
      { cookie: ownerCookie })).status).toBe(404);
    expect((await call('GET', `/api/runtime/approvals/${crypto.randomUUID()}`)).status).toBe(401);
  });
});

describe('deciding it', () => {
  it('refuses a staff member', async () => {
    /* Approving a tool call can run a command on the business's machine —
       the same line the connector decide route draws for customer-facing
       sends. Staff read the card; they do not answer it. */
    const id = await parkWebApproval();
    const response = await call('POST', `/api/runtime/approvals/${id}/decide`,
      { cookie: staffCookie, body: { decision: 'approve' } });
    expect(response.status).toBe(403);
  });

  it('refuses a cross-site POST and a non-JSON body', async () => {
    /* The SameSite=Lax cookie is the real defence; these are the belt to its
       braces, because nothing else stops a cross-site POST from arriving. */
    const id = await parkWebApproval();
    expect((await call('POST', `/api/runtime/approvals/${id}/decide`,
      { cookie: ownerCookie, origin: 'https://evil.test', body: { decision: 'approve' } })).status)
      .toBe(403);
    expect((await call('POST', `/api/runtime/approvals/${id}/decide`,
      { cookie: ownerCookie, origin: null, body: { decision: 'approve' } })).status).toBe(403);
    expect((await call('POST', `/api/runtime/approvals/${id}/decide`,
      { cookie: ownerCookie, contentType: 'text/plain', body: { decision: 'approve' } })).status)
      .toBe(415);
  });

  it('refuses a decision that is neither approve nor deny', async () => {
    const id = await parkWebApproval();
    for (const decision of ['maybe', '', null, 1]) {
      const response = await call('POST', `/api/runtime/approvals/${id}/decide`,
        { cookie: ownerCookie, body: { decision } });
      expect(response.status).toBe(400);
    }
  });

  it('answers 409 when the approval is not pending', async () => {
    /* Expired, already decided otherwise, or simply unknown: the owner is
       told the question is closed rather than being left to wonder. */
    const response = await call('POST',
      `/api/runtime/approvals/${crypto.randomUUID()}/decide`,
      { cookie: ownerCookie, body: { decision: 'approve' } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'APPROVAL_NOT_PENDING' });
  });

  it('reports the runner being unreachable as retryable, and frees the approval', async () => {
    /* The decision is claimed before the runner is told. If the runner cannot
       be reached the claim is released, so the owner can answer again rather
       than the approval being stuck deciding. */
    const id = await parkWebApproval();
    const response = await call('POST', `/api/runtime/approvals/${id}/decide`,
      { cookie: ownerCookie, body: { decision: 'approve' } });
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(await response.json()).toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });

    const after = await call('GET', `/api/runtime/approvals/${id}`, { cookie: ownerCookie });
    expect((await after.json() as { approval: { status: string } }).approval.status)
      .toBe('pending');
  });
});
