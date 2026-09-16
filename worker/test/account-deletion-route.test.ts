/* ============================================================
   DELETE /api/me — the route, not the operation underneath it.

   `requestDeletion` has its own tests; none of them go through the
   route, so until now nothing exercised the Origin gate, the 401, the
   403/409 → JSON mapping, or the email that is the only way back for
   seven days. This repo has lost a route to a per-route method list
   twice; the gate is asserted first here for that reason.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { handleAccount } from '../src/routes/account';
import { asOwner, fetchFake, jsonOf, signIn, testEnv, truncateAll } from './harness';

const SOLO = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };

let cookies: Record<string, string>;
let ids: Record<string, string>;
let sent: { to: string[]; subject: string; text: string }[];

function env(over: Record<string, unknown> = {}): Env {
  return testEnv({
    RESEND_API_KEY: 'resend-test-key',
    APP_ORIGIN: 'https://jentera.ai',
    API_ORIGIN: 'https://api.jentera.ai',
    ...over,
  });
}

/** A DELETE the browser could actually make, Origin and all. */
function call(
  useEnv: Env,
  opts: { cookie?: string; origin?: string | null; body?: unknown; raw?: string } = {},
) {
  const url = new URL('https://api.test/api/me');
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.origin !== null) headers.set('Origin', opts.origin ?? 'https://jentera.ai');
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  const request = new Request(url, {
    method: 'DELETE',
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  return handleAccount(request, useEnv, url, cors);
}

beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, plan) values
      (${SOLO}, 'Solo Shop', 'retail', 'free'), (${TEAM}, 'Kitakod', 'restaurant', 'team')`;
    const rows = await sql<{ id: string; email: string }[]>`
      insert into app_user (email, email_verified) values
        ('solo@example.com', true), ('boss@example.com', true), ('staff@example.com', true)
      returning id, email`;
    const by = Object.fromEntries(rows.map((r) => [r.email.split('@')[0], r.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${by.solo}, ${SOLO}, 'owner'), (${by.boss}, ${TEAM}, 'owner'), (${by.staff}, ${TEAM}, 'staff')`;
    await sql`
      insert into routine
        (business_id, name, task_kind, frequency, time_of_day, time_zone, status,
         created_by, authorised_by, create_request_id)
      values (${SOLO}, 'Daily summary', 'business_summary', 'daily', '09:00',
              'Asia/Kuala_Lumpur', 'active', ${by.solo}, ${by.solo}, gen_random_uuid())`;
    return by;
  });
  ids = users;
  cookies = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([k, id]) => [k, await signIn(id)])),
  );
  sent = [];
  vi.stubGlobal('fetch', fetchFake(async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string });
    return new Response('{"id":"email-1"}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const deletions = () => asOwner((sql) => sql`select 1 from account_deletion`);

describe('DELETE /api/me', () => {
  it.each([
    ['no Origin at all', null],
    ['an origin that is not ours', 'https://evil.example'],
  ])('refuses %s before it reads the session', async (_name, origin) => {
    const response = (await call(env(), {
      cookie: cookies.solo,
      origin,
      body: { email: 'solo@example.com' },
    }))!;

    expect(response.status).toBe(403);
    expect((await jsonOf<{ err: string }>(response)).err).toMatch(/origin/i);
    /* Nothing happened: no record, no lockout, no email. */
    expect(await deletions()).toHaveLength(0);
    expect(sent).toHaveLength(0);
    const [user] = await asOwner((sql) => sql<{ deleted_at: Date | null }[]>`
      select deleted_at from app_user where id = ${ids.solo}`);
    expect(user.deleted_at).toBeNull();
  });

  it('refuses a signed-out request', async () => {
    const response = (await call(env(), { body: { email: 'solo@example.com' } }))!;

    expect(response.status).toBe(401);
    expect(await deletions()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['a different address', { email: 'someone-else@example.com' }],
    ['no address at all', {}],
    ['an address that is not a string', { email: 42 }],
  ])('refuses %s with the 403 the caller can show', async (_name, body) => {
    const response = (await call(env(), { cookie: cookies.solo, body }))!;

    expect(response.status).toBe(403);
    expect((await jsonOf<{ err: string }>(response)).err).toMatch(/email address to confirm/i);
    expect(await deletions()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('treats a body it cannot parse as no confirmation, not a crash', async () => {
    const response = (await call(env(), { cookie: cookies.solo, raw: 'not json at all' }))!;

    expect(response.status).toBe(403);
    expect(await deletions()).toHaveLength(0);
  });

  it('refuses an owner whose team still has members, as a 409', async () => {
    const response = (await call(env(), { cookie: cookies.boss, body: { email: 'boss@example.com' } }))!;

    expect(response.status).toBe(409);
    expect((await jsonOf<{ err: string }>(response)).err).toMatch(/remove the other members/i);
    expect(await deletions()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('schedules it and emails a cancel link that really cancels', async () => {
    const useEnv = env();
    const response = (await call(useEnv, { cookie: cookies.solo, body: { email: 'solo@example.com' } }))!;

    expect(response.status).toBe(200);
    const body = await jsonOf<{ ok: boolean; graceDays: number; routines: number; noticeSent: boolean }>(response);
    /* The server's own count, which is what the screen is allowed to
       promise: routines this person created, not everything they can see. */
    expect(body).toEqual({ ok: true, graceDays: 7, routines: 1, noticeSent: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['solo@example.com']);
    const token = /\/api\/account\/restore\?token=([A-Za-z0-9_-]+)/.exec(sent[0].text)?.[1];
    expect(token).toBeTruthy();

    const restoreUrl = new URL(`https://api.test/api/account/restore?token=${token}`);
    const restored = (await handleAccount(new Request(restoreUrl), useEnv, restoreUrl, cors))!;
    expect(restored.status).toBe(302);
    expect(restored.headers.get('Location')).toBe('https://jentera.ai/signin?restored=1');

    const [user] = await asOwner((sql) => sql<{ deleted_at: Date | null }[]>`
      select deleted_at from app_user where id = ${ids.solo}`);
    expect(user.deleted_at).toBeNull();
    /* And the person is told their account survived, because a mail
       scanner following the link would otherwise cancel it in silence. */
    expect(sent).toHaveLength(2);
    expect(sent[1].to).toEqual(['solo@example.com']);
    expect(sent[1].subject).toMatch(/no longer being deleted|cancelled/i);
  });

  it.each([
    ['the mailer answers with an error', async () => new Response('no', { status: 500 })],
    ['the mailer cannot be reached at all', async () => { throw new TypeError('network down'); }],
  ])('says the cancel email did not go out when %s', async (_name, impl) => {
    vi.stubGlobal('fetch', fetchFake(impl as () => Promise<Response>));
    const response = (await call(env(), { cookie: cookies.solo, body: { email: 'solo@example.com' } }))!;

    /* The transaction committed and every session is revoked. Answering
       500 here would tell the caller it failed while the account is
       locked out and scheduled; answering a plain 200 would tell them a
       cancel link is in their inbox that is not. */
    expect(response.status).toBe(200);
    const body = await jsonOf<{ ok: boolean; noticeSent: boolean }>(response);
    expect(body.ok).toBe(true);
    expect(body.noticeSent).toBe(false);
    expect(await deletions()).toHaveLength(1);
  });

  it('lets a staff member delete their own account', async () => {
    const response = (await call(env(), { cookie: cookies.staff, body: { email: 'staff@example.com' } }))!;

    expect(response.status).toBe(200);
    const [record] = await asOwner((sql) => sql<{ kind: string }[]>`
      select kind from account_deletion where user_id = ${ids.staff}`);
    expect(record.kind).toBe('staff');
    /* The business is not theirs to delete. */
    const [business] = await asOwner((sql) => sql<{ deleted_at: Date | null }[]>`
      select deleted_at from business where id = ${TEAM}`);
    expect(business.deleted_at).toBeNull();
  });
});
