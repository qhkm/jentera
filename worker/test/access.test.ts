import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, testEnv, truncateAll, fetchFake } from './harness';
import { accessForEmail, businessHasAccess, grantActive, TRIAL_HOURS } from '../src/access';
import { issueLoginToken, consumeLoginToken, verifySession, verifyIdentitySession, hashToken, authLandingPath } from '../src/auth';
import { handleAccess } from '../src/routes/access';
import { handleSession } from '../src/routes/session';

const env = () => testEnv({ ACCESS_MODE: 'waitlist' });
async function identity(email: string) {
  const issued = await issueLoginToken(env(), email);
  return (await consumeLoginToken(env(), issued.token!))!;
}
async function invite(code: string, email: string | null, maxClaims = 1) {
  const hash = await hashToken(code);
  await asOwner(sql => sql`insert into trial_invite (token_hash, email, expires_at, max_claims) values (${hash}, ${email}, now() + interval '7 days', ${maxClaims})`);
}
async function redeem(token: string, code: string) {
  const url = new URL('http://localhost:8787/api/access/redeem');
  return handleAccess(new Request(url, { method: 'POST', headers: { Origin: 'http://localhost:5173', Cookie: `aisar_session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }), env(), url, {});
}
beforeEach(async () => {
  await truncateAll();
  await asOwner(sql => sql`truncate platform_access, trial_invite, trial_redemption, waitlist_entry cascade`);
});
describe('restricted access with real Postgres', () => {
  it('lets only one account claim an email-free invitation, even concurrently', async () => {
    const first = await identity('first@example.com');
    const second = await identity('second@example.com');
    const code = 'e'.repeat(48);
    await invite(code, null);
    const results = await Promise.all([redeem(first.token, code), redeem(second.token, code)]);
    expect(results.map(r => r!.status).sort()).toEqual([200, 400]);
    const grants = await asOwner(sql => sql`select expires_at from platform_access where kind='trial'`);
    expect(grants).toHaveLength(1);
    expect(new Date(grants[0].expires_at).getTime() - Date.now()).toBeGreaterThan(71.9 * 3600000);
    expect(await asOwner(sql => sql`select * from trial_redemption`)).toHaveLength(1);
  });
  it('atomically caps a shared invitation at its configured claim limit', async () => {
    const people = await Promise.all(['one', 'two', 'three', 'four'].map(name => identity(`${name}@example.com`)));
    const code = 'g'.repeat(48);
    await invite(code, null, 3);
    const results = await Promise.all(people.map(person => redeem(person.token, code)));
    expect(results.map(result => result!.status).sort()).toEqual([200, 200, 200, 400]);
    const [inviteRow] = await asOwner(sql => sql`select claim_count,max_claims from trial_invite`);
    expect(inviteRow).toMatchObject({ claim_count: 3, max_claims: 3 });
    expect(await asOwner(sql => sql`select token_hash from trial_redemption`)).toHaveLength(3);
  });
  it('rejects expired and revoked email-free invitations', async () => {
    const person = await identity('recipient@example.com');
    await invite('f'.repeat(48), null);
    await asOwner(sql => sql`update trial_invite set revoked_at=now()`);
    expect((await redeem(person.token, 'f'.repeat(48)))!.status).toBe(400);
    await asOwner(sql => sql`update trial_invite set revoked_at=null,expires_at=now()-interval '1 second'`);
    expect((await redeem(person.token, 'f'.repeat(48)))!.status).toBe(400);
  });
  it('uses exactly 72 hours and rejects expired/revoked grants', () => {
    expect(TRIAL_HOURS).toBe(72);
    expect(grantActive(undefined)).toBe(false);
    expect(grantActive({ expires_at: new Date(100), revoked_at: null }, 100)).toBe(false);
    expect(grantActive({ expires_at: null, revoked_at: new Date() })).toBe(false);
  });
  it('blocks old sessions while preserving identity, and allows the verified owner', async () => {
    const free = await identity('free@example.com');
    expect(await verifyIdentitySession(env(), free.token)).not.toBeNull();
    expect(await verifySession(env(), free.token)).toBeNull();
    expect(await authLandingPath(env(), free.userId)).toBe('/access');
    const owner = await identity('qhkmdev90@gmail.com');
    expect(await verifySession(env(), owner.token)).not.toBeNull();
    expect((await accessForEmail(env(), 'qhkmdev90+other@gmail.com')).allowed).toBe(false);
  });
  it('redeems atomically once and expires 72 hours later without resetting', async () => {
    const person = await identity('trial@example.com');
    const code = 'a'.repeat(32);
    await invite(code, person.email);
    const results = await Promise.all([redeem(person.token, code), redeem(person.token, code)]);
    expect(results.map(result => result!.status).sort()).toEqual([200, 400]);
    expect(await verifySession(env(), person.token)).not.toBeNull();
    await asOwner(async sql => {
      const [row] = await sql`select extract(epoch from (expires_at - started_at)) as seconds from trial_redemption where user_id = ${person.userId}`;
      expect(Number(row.seconds)).toBe(72 * 3600);
      await sql`update platform_access set expires_at = now() - interval '1 second' where email = ${person.email}`;
    });
    expect(await verifySession(env(), person.token)).toBeNull();
    await invite('b'.repeat(32), person.email);
    expect((await redeem(person.token, 'b'.repeat(32)))!.status).toBe(400);
  });
  it('does not let a different verified address consume an email-bound invite', async () => {
    const person = await identity('wrong@example.com');
    await invite('c'.repeat(32), 'recipient@example.com');
    expect((await redeem(person.token, 'c'.repeat(32)))!.status).toBe(400);
    const recipient = await identity('recipient@example.com');
    expect((await redeem(recipient.token, 'c'.repeat(32)))!.status).toBe(200);
  });
  it('closes password signup without inserting an account', async () => {
    const url = new URL('http://localhost:8787/api/auth/signup');
    const response = await handleSession(new Request(url, { method: 'POST', body: JSON.stringify({ email: 'new@example.com', password: 'safe password' }) }), env(), url, {});
    expect(response!.status).toBe(403);
    expect(await asOwner(sql => sql`select id from app_user where email = 'new@example.com'`)).toHaveLength(0);
  });
  it('requires an explicit paid grant, and respects revocation', async () => {
    const person = await identity('paid@example.com');
    await asOwner(sql => sql`insert into platform_access (email, kind, expires_at) values (${person.email}, 'paid', now() + interval '1 day')`);
    expect(await verifySession(env(), person.token)).not.toBeNull();
    await asOwner(sql => sql`update platform_access set revoked_at = now() where email = ${person.email}`);
    expect(await verifySession(env(), person.token)).toBeNull();
  });
  it('does not grant background work merely because a business is on pro', async () => {
    const person = await identity('pro@example.com');
    const business = '11111111-1111-4111-8111-111111111111';
    await asOwner(async sql => {
      await sql`insert into business (id, name, playbook_key, plan) values (${business}, 'Pro business', 'restaurant', 'pro')`;
      await sql`insert into membership (business_id, user_id, role) values (${business}, ${person.userId}, 'owner')`;
    });
    expect(await businessHasAccess(env(), business)).toBe(false);
    await asOwner(sql => sql`insert into platform_access (email, kind, expires_at) values (${person.email}, 'paid', now() + interval '1 day')`);
    expect(await businessHasAccess(env(), business)).toBe(true);
  });
  it('rejects expired invitations and cross-origin redemption', async () => {
    const person = await identity('expiry@example.com');
    await invite('d'.repeat(32), person.email);
    await asOwner(sql => sql`update trial_invite set expires_at = now() - interval '1 second'`);
    expect((await redeem(person.token, 'd'.repeat(32)))!.status).toBe(400);
    const url = new URL('http://localhost:8787/api/access/redeem');
    const response = await handleAccess(new Request(url, { method: 'POST', headers: { Origin: 'https://evil.test', Cookie: `aisar_session=${person.token}` }, body: JSON.stringify({ code: 'd'.repeat(32) }) }), env(), url, {});
    expect(response!.status).toBe(403);
  });
  it('deduplicates waitlist submissions without creating users', async () => {
    const url = new URL('http://localhost:8787/api/waitlist');
    for (let i = 0; i < 2; i++) {
      const response = await handleAccess(new Request(url, { method: 'POST', headers: { Origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'Waiting@example.com' }) }), env(), url, {});
      expect(response!.status).toBe(202);
    }
    expect(await asOwner(sql => sql`select email from waitlist_entry`)).toHaveLength(1);
    expect(await asOwner(sql => sql`select id from app_user`)).toHaveLength(0);
  });
  it('notifies only the admin once for a new waitlist address', async () => {
    const fetch = fetchFake(async () => Response.json({ id: 'mail-1' }));
    vi.stubGlobal('fetch', fetch);
    try {
      const url = new URL('http://localhost:8787/api/waitlist');
      const pending: Promise<unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const response = await handleAccess(new Request(url, { method: 'POST', headers: { Origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'Waiting@example.com' }) }), testEnv({ SIGNUP_NOTICE_TO: 'qhkmdev90@gmail.com', RESEND_API_KEY: 'test-key' }), url, {}, { waitUntil: promise => { pending.push(promise); } });
        expect(response!.status).toBe(202);
      }
      await Promise.all(pending);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ to: ['qhkmdev90@gmail.com'], subject: 'New Jentera waitlist signup: waiting@example.com' });
      expect(pending).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps the waitlist entry when the admin email fails', async () => {
    vi.stubGlobal('fetch', fetchFake(async () => { throw new Error('Mail unavailable'); }));
    try {
      const url = new URL('http://localhost:8787/api/waitlist');
      const response = await handleAccess(new Request(url, { method: 'POST', headers: { Origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'waiting@example.com' }) }), testEnv({ SIGNUP_NOTICE_TO: 'qhkmdev90@gmail.com', RESEND_API_KEY: 'test-key' }), url, {});
      expect(response!.status).toBe(202);
      expect(await asOwner(sql => sql`select email from waitlist_entry`)).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
