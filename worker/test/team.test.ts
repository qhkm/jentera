import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { handleSession } from '../src/routes/session';
import { handleTeam } from '../src/routes/team';
import { asOwner, asTenant, fetchFake, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const TEAM = '11111111-1111-4111-8111-111111111111';
const FREE = '22222222-2222-4222-8222-222222222222';
const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };
let cookies: Record<string, string>;
let ids: Record<string, string>;
let sent: { to: string[]; subject: string; text: string }[];

function env(over: Record<string, unknown> = {}): Env {
  return testEnv({ RESEND_API_KEY: 'resend-test-key', APP_ORIGIN: 'https://jentera.ai', ...over });
}

beforeEach(async () => {
  await truncateAll();
  const users = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, plan) values
      (${TEAM}, 'Kitakod', 'restaurant', 'team'), (${FREE}, 'Solo', 'retail', 'free')`;
    const rows = await sql<{ id: string; email: string }[]>`insert into app_user (email, email_verified) values
      ('owner@example.com', true), ('staff@example.com', true), ('solo@example.com', true),
      ('new@example.com', true), ('other@example.com', true) returning id, email`;
    const by = Object.fromEntries(rows.map((r) => [r.email.split('@')[0], r.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${by.owner}, ${TEAM}, 'owner'), (${by.staff}, ${TEAM}, 'staff'), (${by.solo}, ${FREE}, 'owner')`;
    return by;
  });
  ids = users;
  cookies = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([k, id]) => [k, await signIn(id)])));
  sent = [];
  vi.stubGlobal('fetch', fetchFake(async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string });
    return new Response('{"id":"email-1"}', { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function call(method: string, path: string, cookie: string, body?: unknown, useEnv = env()) {
  const incoming = req(method, path, { cookie, body });
  incoming.request.headers.set('Origin', 'https://jentera.ai');
  const response = await handleTeam(incoming.request, useEnv, incoming.url, cors);
  if (!response) throw new Error('team route did not match');
  return response;
}

/** Invite as the team owner and read the token out of the email, the only place it appears. */
async function invite(email: string): Promise<{ response: Response; token: string | null }> {
  const before = sent.length;
  const response = await call('POST', '/api/team/invitations', cookies.owner, { email });
  const mail = sent[before];
  const token = mail ? /\/join\?token=([0-9a-f]{64})/.exec(mail.text)?.[1] ?? null : null;
  return { response, token };
}

const accept = (cookie: string, token: string) => call('POST', '/api/team/invitations/accept', cookie, { token });

describe('the team: members and invitations', () => {
  it('lists members and open invitations to every member, and only the owner may manage', async () => {
    const asOwnerView = await jsonOf<{ members: { email: string; role: string; you: boolean }[]; invitations: unknown[]; canManage: boolean }>(
      await call('GET', '/api/team', cookies.owner));
    expect(asOwnerView.members.map((m) => [m.email, m.role, m.you])).toEqual([
      ['owner@example.com', 'owner', true], ['staff@example.com', 'staff', false],
    ]);
    expect(asOwnerView.invitations).toEqual([]);
    expect(asOwnerView.canManage).toBe(true);
    const asStaffView = await jsonOf<{ canManage: boolean; members: unknown[] }>(await call('GET', '/api/team', cookies.staff));
    expect(asStaffView.canManage).toBe(false);
    expect(asStaffView.members).toHaveLength(2);
  });

  it('lets the owner invite an address; the email carries the token and the response never does', async () => {
    const { response, token } = await invite('New@Example.com');
    expect(response.status).toBe(201);
    const body = await jsonOf<{ invitation: Record<string, unknown> }>(response);
    expect(body.invitation).toMatchObject({ email: 'new@example.com', role: 'staff' });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(sent[0].to).toEqual(['new@example.com']);
    expect(sent[0].subject).toMatch(/Kitakod/);
    expect(sent[0].text).toContain('https://jentera.ai/join?token=');
    const rows = await asTenant(TEAM, (tx) => tx<{ email: string; token_hash: string; invited_by: string; expires_at: Date }[]>`
      select email, token_hash, invited_by, expires_at from invitation`);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('new@example.com');
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].invited_by).toBe(ids.owner);
    expect(rows[0].expires_at.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 3_600_000);
    const listed = await jsonOf<{ invitations: { email: string }[] }>(await call('GET', '/api/team', cookies.staff));
    expect(listed.invitations.map((i) => i.email)).toEqual(['new@example.com']);
  });

  it('refuses an invitation off the team plan, from staff, to a member, to a bad address, or twice', async () => {
    expect((await call('POST', '/api/team/invitations', cookies.solo, { email: 'new@example.com' })).status).toBe(402);
    expect((await call('POST', '/api/team/invitations', cookies.staff, { email: 'new@example.com' })).status).toBe(403);
    expect((await invite('staff@example.com')).response.status).toBe(409);
    expect((await invite('owner@example.com')).response.status).toBe(409);
    expect((await invite('not-an-address')).response.status).toBe(400);
    expect((await invite('new@example.com')).response.status).toBe(201);
    expect((await invite('new@example.com')).response.status).toBe(409);
    expect(sent).toHaveLength(1);
  });

  it('lets the invited person accept once signed in with that address, and they are staff from then on', async () => {
    const { token } = await invite('new@example.com');
    const response = await accept(cookies.new, token!);
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toMatchObject({ ok: true, businessName: 'Kitakod' });
    const [membership] = await asOwner((sql) => sql<{ business_id: string; role: string }[]>`
      select business_id, role from membership where user_id = ${ids.new}`);
    expect(membership).toEqual({ business_id: TEAM, role: 'staff' });
    const me = req('GET', '/api/me', { cookie: cookies.new });
    expect(await jsonOf((await handleSession(me.request, env(), me.url, cors))!)).toMatchObject({ businessId: TEAM, role: 'staff' });
    const listed = await jsonOf<{ invitations: unknown[]; members: unknown[] }>(await call('GET', '/api/team', cookies.owner));
    expect(listed.invitations).toEqual([]);
    expect(listed.members).toHaveLength(3);
    expect((await accept(cookies.new, token!)).status).toBe(410);
  });

  it('refuses acceptance by another address, of a revoked or expired invitation, or into a second business', async () => {
    const { token, response } = await invite('new@example.com');
    const created = await jsonOf<{ invitation: { id: string } }>(response);
    expect((await accept(cookies.other, token!)).status).toBe(403);
    expect((await accept(cookies.new, 'f'.repeat(64))).status).toBe(404);
    expect((await accept(cookies.new, 'nonsense')).status).toBe(400);

    expect((await call('DELETE', `/api/team/invitations/${created.invitation.id}`, cookies.staff)).status).toBe(403);
    expect((await call('DELETE', `/api/team/invitations/${created.invitation.id}`, cookies.owner)).status).toBe(200);
    expect((await accept(cookies.new, token!)).status).toBe(410);
    expect((await jsonOf<{ invitations: unknown[] }>(await call('GET', '/api/team', cookies.owner))).invitations).toEqual([]);

    const again = await invite('new@example.com');
    await asOwner((sql) => sql`update invitation set expires_at = now() - interval '1 minute' where email = 'new@example.com' and revoked_at is null`);
    expect((await accept(cookies.new, again.token!)).status).toBe(410);

    const forSolo = await invite('solo@example.com');
    expect((await accept(cookies.solo, forSolo.token!)).status).toBe(409);
    expect(await asOwner((sql) => sql`select 1 from membership where user_id = ${ids.solo} and business_id = ${TEAM}`)).toHaveLength(0);
  });

  it('removes a staff member: their session ends, their devices and workspaces forget them, their invitation dies', async () => {
    /* A device, a workspace seat and an open re-invitation for the same address, all of which must go. */
    await asTenant(TEAM, async (tx) => {
      await tx`insert into push_subscription (business_id, user_id, endpoint, p256dh, auth) values
        (${TEAM}, ${ids.staff}, 'https://push.example/staff-1', ${'p'.repeat(87)}, ${'a'.repeat(22)})`;
      await tx`insert into workspace (business_id, name, created_by) values (${TEAM}, 'Marketing', ${ids.owner})`;
      const [{ id }] = await tx<{ id: string }[]>`select id from workspace where business_id = ${TEAM}`;
      await tx`insert into workspace_member (business_id, workspace_id, user_id) values (${TEAM}, ${id}, ${ids.staff})`;
    });
    expect((await call('DELETE', `/api/team/members/${ids.staff}`, cookies.staff)).status).toBe(403);
    expect((await call('DELETE', `/api/team/members/${ids.owner}`, cookies.owner)).status).toBe(409);
    expect((await call('DELETE', `/api/team/members/${ids.new}`, cookies.owner)).status).toBe(404);
    expect((await call('DELETE', `/api/team/members/${ids.staff}`, cookies.owner)).status).toBe(200);

    const me = req('GET', '/api/me', { cookie: cookies.staff });
    expect((await handleSession(me.request, env(), me.url, cors))!.status).toBe(401);
    expect(await asOwner((sql) => sql`select 1 from membership where user_id = ${ids.staff}`)).toHaveLength(0);
    expect(await asOwner((sql) => sql`select 1 from push_subscription where user_id = ${ids.staff}`)).toHaveLength(0);
    expect(await asOwner((sql) => sql`select 1 from workspace_member where user_id = ${ids.staff}`)).toHaveLength(0);
    const listed = await jsonOf<{ members: { email: string }[] }>(await call('GET', '/api/team', cookies.owner));
    expect(listed.members.map((m) => m.email)).toEqual(['owner@example.com']);
    /* Invited again afterwards, they come back through the same door. */
    expect((await invite('staff@example.com')).response.status).toBe(201);
  });
});
