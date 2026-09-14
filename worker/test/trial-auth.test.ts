import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openTrial, sealTrial, trialLanding } from '../src/trial-auth';
import { handleSession } from '../src/routes/session';
import { asOwner, testEnv, truncateAll } from './harness';
import { issueLoginToken } from '../src/auth';

vi.mock('../src/oauth', async original => ({ ...await original<typeof import('../src/oauth')>(),
  exchangeCode: vi.fn(async () => ({ subject: 'test-google', email: 'invitee@example.com', emailVerified: true, name: 'Invitee' })),
}));
const code = 'a'.repeat(48);
const env = () => testEnv({ ACCESS_MODE: 'waitlist', GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test' });
afterEach(() => vi.useRealTimers());
beforeEach(async () => { await truncateAll(); });
describe('invitation authentication carry-through', () => {
  it('encrypts and authenticates the code, binding it to exactly one login attempt', async () => {
    const sealed = await sealTrial(env(), code, 'google:state-a');
    expect(sealed).not.toContain(code);
    expect(await openTrial(env(), sealed, 'google:state-a')).toBe(code);
    expect(await openTrial(env(), sealed, 'google:state-b')).toBe('');
    expect(await openTrial(env(), 'X' + sealed.slice(1), 'google:state-a')).toBe('');
    expect(await openTrial(env(), 'bad', 'google:state-a')).toBe('');
    expect(await sealTrial(env(), 'https://evil.example', 'state')).toBe('');
    expect(trialLanding('https://evil.example', '/access')).toBe('/access');
  });
  it('expires carry-through after 15 minutes without changing trial lifetime', async () => {
    vi.useFakeTimers();
    const sealed = await sealTrial(env(), code, 'email:one');
    vi.advanceTimersByTime(15 * 60_000);
    expect(await openTrial(env(), sealed, 'email:one')).toBe('');
  });
  it('restores the invitation through the Google callback without browser storage', async () => {
    const url = new URL('http://localhost:8787/api/auth/google');
    const start = (await handleSession(new Request(url, { method: 'POST', headers: { Origin: 'http://localhost:5173' }, body: new URLSearchParams({ inviteCode: code }) }), env(), url, {}))!;
    expect(start.status).toBe(302);
    const cookie = start.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain(code);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state');
    const callback = new URL(`http://localhost:8787/api/auth/google/callback?state=${state}&code=fake`);
    const response = (await handleSession(new Request(callback, { headers: { Cookie: cookie.split(';')[0] } }), env(), callback, {}))!;
    expect(response.headers.get('Location')).toBe(`${env().APP_ORIGIN}/access?invite=1#code=${code}`);
    expect(await asOwner(sql => sql`select * from trial_redemption`)).toHaveLength(0);
  });
  it('starts state-bound Google OAuth from an opaque-origin invite browser', async () => {
    const url = new URL('http://localhost:8787/api/auth/google');
    const result = (await handleSession(new Request(url, { method: 'POST', headers: { Origin: 'null' }, body: new URLSearchParams({ inviteCode: code }) }), env(), url, {}))!;
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(result.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(result.headers.get('Set-Cookie')).not.toContain(code);
  });
  it('does not reflect an invalid cross-origin invite value', async () => {
    const url = new URL('http://localhost:8787/api/auth/google');
    const result = (await handleSession(new Request(url, { method: 'POST', headers: { Origin: 'null' }, body: new URLSearchParams({ inviteCode: 'https://evil.test/#secret' }) }), env(), url, {}))!;
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(result.headers.get('Location')).not.toContain('evil');
    expect(result.headers.get('Set-Cookie')).not.toContain('evil');
  });
  it('restores an email invite in another browser and rejects login-link replay', async () => {
    const { token } = await issueLoginToken(env(), 'email-invite@example.com');
    const carry = await sealTrial(env(), code, `email:${token}`);
    const url = new URL(`http://localhost:8787/api/auth/consume?token=${token}&invite=${carry}`);
    const response = (await handleSession(new Request(url), env(), url, {}))!;
    expect(response.headers.get('Location')).toBe(`${env().APP_ORIGIN}/access?invite=1#code=${code}`);
    const replay = (await handleSession(new Request(url), env(), url, {}))!;
    expect(replay.headers.get('Location')).toContain('error=expired');
  });
});
