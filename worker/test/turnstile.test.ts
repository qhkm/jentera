/* ============================================================
   A human check in front of the three password-and-link doors.
   Google's own sign-in is not covered here; it has Google in front.
   ============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, fetchFake, req, testEnv, truncateAll } from './harness';
import { handleSession } from '../src/routes/session';
import { SITEVERIFY, turnstileIdempotencyKey, verifyTurnstile } from '../src/turnstile';

const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };

function env(over: Record<string, unknown> = {}) {
  return testEnv({
    RESEND_API_KEY: 'resend-test-key',
    APP_ORIGIN: 'https://jentera.ai',
    ALLOWED_ORIGINS: 'http://localhost:5173,https://jentera.ai',
    TURNSTILE_SECRET: 'ts-secret',
    ...over,
  });
}

/** Resend answers ok; siteverify answers whatever `success` says, for a
    token minted on our own page unless `minted` says otherwise. */
function outbound(success: boolean, minted: { action?: string; hostname?: string } = {}) {
  return fetchFake(async (input) =>
    String(input) === SITEVERIFY
      ? Response.json({ success, action: minted.action ?? 'signin', hostname: minted.hostname ?? 'jentera.ai' })
      : Response.json({ id: 'email-id' }));
}

function post(path: string, body: Record<string, unknown>) {
  const { request, url } = req('POST', path, { body });
  request.headers.set('CF-Connecting-IP', '203.0.113.9');
  return { request, url };
}

async function accounts(): Promise<number> {
  const [{ n }] = await asOwner((sql) => sql<{ n: number }[]>`select count(*)::int as n from app_user`);
  return n;
}

describe('verifyTurnstile', () => {
  it('is skipped entirely when no secret is configured', async () => {
    const fetchMock = outbound(false);
    expect(await verifyTurnstile(testEnv(), undefined, '203.0.113.9', fetchMock)).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing token without asking Cloudflare', async () => {
    const fetchMock = outbound(true);
    expect(await verifyTurnstile(env(), undefined, '203.0.113.9', fetchMock)).toBe('missing');
    expect(await verifyTurnstile(env(), '', '203.0.113.9', fetchMock)).toBe('missing');
    expect(await verifyTurnstile(env(), 'x'.repeat(3000), '203.0.113.9', fetchMock)).toBe('missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the secret, the token and the caller address, and reads the verdict', async () => {
    const fetchMock = outbound(true);
    expect(await verifyTurnstile(env(), 'tok-1', '203.0.113.9', fetchMock)).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(SITEVERIFY);
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('secret')).toBe('ts-secret');
    expect(form.get('response')).toBe('tok-1');
    expect(form.get('remoteip')).toBe('203.0.113.9');

    expect(await verifyTurnstile(env(), 'tok-2', '203.0.113.9', outbound(false))).toBe('rejected');
  });

  it('rejects a real token minted for another action or another site', async () => {
    /* One widget can be embedded anywhere its hostnames allow, and a
       token is a token. The verdict says where it was made; a token from
       a page on another host, or from a different action, is not ours. */
    expect(await verifyTurnstile(env(), 'tok-4', '203.0.113.9', outbound(true, { action: 'contact' }))).toBe('rejected');
    expect(await verifyTurnstile(env(), 'tok-5', '203.0.113.9', outbound(true, { hostname: 'evil.example' }))).toBe('rejected');
    expect(await verifyTurnstile(env(), 'tok-6', '203.0.113.9', outbound(true, { hostname: 'localhost' }))).toBe('ok');
  });

  it('asks Cloudflare with a ten-second limit', async () => {
    const fetchMock = outbound(true);
    await verifyTurnstile(env(), 'tok-7', '203.0.113.9', fetchMock);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('lets a request through when Cloudflare itself cannot be reached', async () => {
    /* The rate limits underneath still hold; an outage at the checker
       must not close every door. */
    const down = fetchFake(async () => { throw new TypeError('Failed to fetch'); });
    expect(await verifyTurnstile(env(), 'tok-3', '203.0.113.9', down)).toBe('unavailable');
    const broken = fetchFake(async () => new Response('bad gateway', { status: 502 }));
    expect(await verifyTurnstile(env(), 'tok-3', '203.0.113.9', broken)).toBe('unavailable');
  });
});

describe('the doors with a secret configured', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a signup without a token and makes no account', async () => {
    vi.stubGlobal('fetch', outbound(true));
    const { request, url } = post('/api/auth/signup', { email: 'bot@example.com', password: 'correct horse battery' });
    const response = await handleSession(request, env(), url, cors);
    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({ ok: false, code: 'TURNSTILE' });
    expect(await accounts()).toBe(0);
  });

  it('refuses a signup whose token Cloudflare rejects', async () => {
    vi.stubGlobal('fetch', outbound(false));
    const { request, url } = post('/api/auth/signup', { email: 'bot@example.com', password: 'correct horse battery', turnstileToken: 'forged' });
    const response = await handleSession(request, env(), url, cors);
    expect(response?.status).toBe(400);
    expect(await accounts()).toBe(0);
  });

  it('admits a signup with a good token', async () => {
    vi.stubGlobal('fetch', outbound(true));
    const { request, url } = post('/api/auth/signup', { email: 'human@example.com', password: 'correct horse battery', turnstileToken: 'tok-1' });
    const response = await handleSession(request, env(), url, cors);
    expect(response?.status).toBe(202);
    expect(await accounts()).toBe(1);
  });

  it('refuses a link request and a password login without a token', async () => {
    vi.stubGlobal('fetch', outbound(true));
    const link = post('/api/auth/request', { email: 'someone@example.com' });
    expect((await handleSession(link.request, env(), link.url, cors))?.status).toBe(400);
    const login = post('/api/auth/login', { email: 'someone@example.com', password: 'correct horse battery' });
    expect((await handleSession(login.request, env(), login.url, cors))?.status).toBe(400);
  });
});

describe('the doors with no secret configured', () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('behave as before: a signup without a token is accepted', async () => {
    vi.stubGlobal('fetch', outbound(false));
    const { request, url } = post('/api/auth/signup', { email: 'human@example.com', password: 'correct horse battery' });
    const response = await handleSession(request, env({ TURNSTILE_SECRET: undefined }), url, cors);
    expect(response?.status).toBe(202);
    expect(await accounts()).toBe(1);
  });
});

describe('verifyTurnstile for another page', () => {
  const booking = { action: 'booking', hostnames: new Set(['sites.test']) };

  it('accepts a token minted on the booking page', async () => {
    const fetchMock = outbound(true, { action: 'booking', hostname: 'sites.test' });
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', fetchMock, booking)).toBe('ok');
  });

  it('refuses a sign-in token on the booking page, and a booking token from another host', async () => {
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', outbound(true), booking)).toBe('rejected');
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9',
      outbound(true, { action: 'booking', hostname: 'jentera.ai' }), booking)).toBe('rejected');
  });

  it('keeps the sign-in check unchanged when no expectation is passed', async () => {
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', outbound(true))).toBe('ok');
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9',
      outbound(true, { action: 'booking', hostname: 'jentera.ai' }))).toBe('rejected');
  });

  it('sends an idempotency key only when the page gives one', async () => {
    const keyed = outbound(true, { action: 'booking', hostname: 'sites.test' });
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', keyed,
      { ...booking, idempotencyKey: '33333333-3333-4333-8333-333333333333' })).toBe('ok');
    const sent = new URLSearchParams(String(keyed.mock.calls[0][1]?.body));
    expect(sent.get('idempotency_key')).toBe('33333333-3333-4333-8333-333333333333');
    expect(sent.get('response')).toBe('token');

    const unkeyed = outbound(true, { action: 'booking', hostname: 'sites.test' });
    await verifyTurnstile(env(), 'token', '203.0.113.9', unkeyed, booking);
    expect(new URLSearchParams(String(unkeyed.mock.calls[0][1]?.body)).has('idempotency_key')).toBe(false);

    const signin = outbound(true);
    expect(await verifyTurnstile(env(), 'token', '203.0.113.9', signin)).toBe('ok');
    expect(new URLSearchParams(String(signin.mock.calls[0][1]?.body)).has('idempotency_key')).toBe(false);
  });

  it('derives one idempotency key per form and token, as a version 4 UUID', async () => {
    const form = '33333333-3333-4333-8333-333333333333';
    // SHA-256("<form>:tok"), first 16 bytes, version nibble 4, variant 10xx.
    expect(await turnstileIdempotencyKey(form, 'tok')).toBe('4e866874-52bb-4410-ac37-379ad9ea1b5a');
    expect(await turnstileIdempotencyKey(form, 'tok')).toBe(await turnstileIdempotencyKey(form, 'tok'));
    const keys = await Promise.all([
      turnstileIdempotencyKey(form, 'tok'), turnstileIdempotencyKey(form, 'tok-2'),
      turnstileIdempotencyKey('44444444-4444-4444-8444-444444444444', 'tok'),
    ]);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(keys).size).toBe(3);
  });

  it('needs no ALLOWED_ORIGINS when an expectation is passed', async () => {
    const sitesOnly = { TURNSTILE_SECRET: 'ts-secret' };
    const fetchMock = outbound(true, { action: 'booking', hostname: 'sites.test' });
    expect(await verifyTurnstile(sitesOnly, 'token', '203.0.113.9', fetchMock, booking)).toBe('ok');
  });
});
