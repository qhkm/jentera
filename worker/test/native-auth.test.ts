import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeLoginToken,
  hashToken,
  issueLoginToken,
  issueNativeCode,
  redeemNativeCode,
  verifySession,
} from '../src/auth';
import { handleSession } from '../src/routes/session';
import { asApp, asOwner, signIn, testEnv, truncateAll } from './harness';

const BUSINESS_ID = '33333333-3333-4333-8333-333333333333';
const STATE = 'state-0123456789abcdef';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const ORIGIN = 'http://localhost:5173';

let browserToken: string;
let cookie: string;

beforeEach(async () => {
  await truncateAll();
  const userId = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${BUSINESS_ID}, 'Kedai', 'restaurant')`;
    const [user] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('native-owner@example.com', true)
      returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${user.id}, ${BUSINESS_ID}, 'owner')`;
    return user.id;
  });
  cookie = await signIn(userId);
  browserToken = cookie.replace(/^aisar_session=/, '').split(';')[0];
});

async function issue(): Promise<string> {
  const code = await issueNativeCode(testEnv(), browserToken, {
    state: STATE,
    codeChallenge: CHALLENGE,
  });
  if (!code) throw new Error('fixture could not issue a native code');
  return code;
}

describe('minting a native code', () => {
  it('returns a random base64url code for a live verified session', async () => {
    await expect(issue()).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores only the hash', async () => {
    const code = await issue();
    const rows = await asApp((sql) =>
      sql<{ id: string }[]>`select id from native_auth_code`);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(await hashToken(code));
    expect(rows[0].id).not.toBe(code);
  });

  it('refuses a revoked browser session', async () => {
    await asOwner((sql) => sql`update session set revoked_at = now()`);
    await expect(issueNativeCode(testEnv(), browserToken, {
      state: STATE,
      codeChallenge: CHALLENGE,
    })).resolves.toBeNull();
  });

  it('requires the cookie transport and an allowed browser origin at the route', async () => {
    const url = new URL('https://api.test/api/auth/native/code');
    const make = (headers: Record<string, string>) => new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ state: STATE, codeChallenge: CHALLENGE }),
    });
    const env = testEnv();

    const bearerOnly = await handleSession(make({
      Origin: ORIGIN,
      Authorization: `Bearer ${browserToken}`,
    }), env, url, {});
    expect(bearerOnly?.status).toBe(401);

    const foreign = await handleSession(make({
      Origin: 'https://evil.test',
      Cookie: cookie,
    }), env, url, {});
    expect(foreign?.status).toBe(403);

    const response = await handleSession(make({ Origin: ORIGIN, Cookie: cookie }), env, url, {});
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ ok: true, code: expect.any(String) });
  });
});

describe('carrying native auth through an email link', () => {
  it('returns the server-stored state and challenge when the link is consumed', async () => {
    const { token } = await issueLoginToken(
      testEnv(),
      'email-native@example.com',
      { state: STATE, codeChallenge: CHALLENGE },
    );
    const session = await consumeLoginToken(testEnv(), token!);
    expect(session?.native).toEqual({ state: STATE, codeChallenge: CHALLENGE });
  });

  it('leaves an ordinary browser magic link unchanged', async () => {
    const { token } = await issueLoginToken(testEnv(), 'email-web@example.com');
    const session = await consumeLoginToken(testEnv(), token!);
    expect(session?.native).toBeUndefined();
  });
});

describe('exchanging a native code', () => {
  it('returns a distinct session token that authenticates', async () => {
    const session = await redeemNativeCode(testEnv(), {
      code: await issue(),
      state: STATE,
      codeVerifier: VERIFIER,
    });
    expect(session?.token).toBeTruthy();
    expect(session?.token).not.toBe(browserToken);
    const identity = await verifySession(testEnv(), session!.token);
    expect(identity?.businessId).toBe(BUSINESS_ID);

    const rows = await asApp((sql) =>
      sql<{ id: string }[]>`select id from session where revoked_at is null`);
    expect(rows).toHaveLength(2);
  });

  it('allows only one exchange', async () => {
    const code = await issue();
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: STATE,
      codeVerifier: VERIFIER,
    })).resolves.not.toBeNull();
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: STATE,
      codeVerifier: VERIFIER,
    })).resolves.toBeNull();
  });

  it('refuses and consumes a code after a wrong verifier', async () => {
    const code = await issue();
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: STATE,
      codeVerifier: 'wrong-verifier-which-is-long-enough-for-pkce-0000',
    })).resolves.toBeNull();
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: STATE,
      codeVerifier: VERIFIER,
    })).resolves.toBeNull();
  });

  it('refuses and consumes a code after a mismatched state', async () => {
    const code = await issue();
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: 'someone-elses-state',
      codeVerifier: VERIFIER,
    })).resolves.toBeNull();
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: STATE,
      codeVerifier: VERIFIER,
    })).resolves.toBeNull();
  });

  it('refuses an expired code', async () => {
    const code = await issue();
    await asOwner((sql) =>
      sql`update native_auth_code set expires_at = now() - interval '1 second'`);
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: STATE,
      codeVerifier: VERIFIER,
    })).resolves.toBeNull();
  });

  it('refuses when the browser session was revoked after minting', async () => {
    const code = await issue();
    await asOwner((sql) => sql`update session set revoked_at = now()`);
    await expect(redeemNativeCode(testEnv(), {
      code,
      state: STATE,
      codeVerifier: VERIFIER,
    })).resolves.toBeNull();
  });

  it('exposes the exchange only to allowed native origins', async () => {
    const code = await issue();
    const url = new URL('https://api.test/api/auth/native/token');
    const request = (origin: string) => new Request(url, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state: STATE, codeVerifier: VERIFIER }),
    });
    const nativeEnv = testEnv({
      ALLOWED_ORIGINS: 'capacitor://app.jentera.ai,https://app.jentera.ai',
    });

    const foreign = await handleSession(request('https://evil.test'), nativeEnv, url, {});
    expect(foreign?.status).toBe(403);

    const response = await handleSession(
      request('capacitor://app.jentera.ai'),
      nativeEnv,
      url,
      {},
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      ok: true,
      token: expect.any(String),
      expiresAt: expect.any(String),
    });
  });
});

describe('what a native session is', () => {
  it('is marked native and expires in 7 days, not 30', async () => {
    const code = (await issueNativeCode(testEnv(), browserToken, { state: STATE, codeChallenge: CHALLENGE }))!;
    const session = (await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER }))!;

    const days = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const sessionId = await hashToken(session.token);
    const rows = await asApp((sql) => sql<{ kind: string }[]>`
      select kind from session where id = ${sessionId}`);
    expect(rows[0]?.kind).toBe('native');
  });

  /* The browser's own session must be untouched by any of this: revoking the
     phone cannot sign out the laptop, which is why the exchange mints a row
     rather than handing over the token it was given. */
  it('leaves the browser session web and 30 days', async () => {
    const browserId = await hashToken(browserToken);
    const rows = await asApp((sql) => sql<{ kind: string }[]>`
      select kind from session where id = ${browserId}`);
    expect(rows[0]?.kind).toBe('web');
  });

  it('can be revoked in bulk by address after a leak', async () => {
    const code = (await issueNativeCode(testEnv(), browserToken, { state: STATE, codeChallenge: CHALLENGE }))!;
    const session = (await redeemNativeCode(testEnv(), { code, state: STATE, codeVerifier: VERIFIER }))!;
    expect(await verifySession(testEnv(), session.token)).not.toBeNull();

    /* The app role must NOT be able to mass-revoke: this is an operator tool,
       and a compromised worker should not be able to sign an estate out. */
    await expect(asApp((sql) => sql`
      select public.revoke_sessions_for_email('native-owner@example.com')`))
      .rejects.toThrow(/permission denied/i);

    const [{ revoke_sessions_for_email: ended }] = await asOwner((sql) => sql<{ revoke_sessions_for_email: number }[]>`
      select public.revoke_sessions_for_email('native-owner@example.com')`);
    expect(Number(ended)).toBeGreaterThanOrEqual(2);

    expect(await verifySession(testEnv(), session.token)).toBeNull();
    expect(await verifySession(testEnv(), browserToken)).toBeNull();
  });
});

describe('the gates on minting', () => {
  /* testEnv() leaves ACCESS_MODE unset, so every other test in this file runs
     the open branch. Production runs waitlist, and until this test that branch
     executed nowhere in CI. */
  it('refuses an address the waitlist has not admitted', async () => {
    const gated = testEnv({ ACCESS_MODE: 'waitlist' });
    expect(await issueNativeCode(gated, browserToken, { state: STATE, codeChallenge: CHALLENGE })).toBeNull();
  });

  it('refuses a code challenge that is not base64url', async () => {
    const url = new URL('https://api.test/api/auth/native/code');
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ state: STATE, codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw~cM' }),
    });
    const response = await handleSession(request, testEnv(), url, {});
    expect(response?.status).toBe(400);
  });

  /* The harness stubs AUTH_BURST permissive, so without this the brake could
     be deleted from the route and the suite would stay green. */
  it('brakes the exchange when the burst limiter refuses', async () => {
    const url = new URL('https://api.test/api/auth/native/token');
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'whatever', state: STATE, codeVerifier: VERIFIER }),
    });
    const braked = testEnv({ AUTH_BURST: { limit: async () => ({ success: false }) } });
    const response = await handleSession(request, braked, url, {});
    expect(response?.status).toBe(429);
  });
});

describe('the native doors are shut by default', () => {
  /* Production ships NATIVE_AUTH_ENABLED="false" because the callback is
     still a custom scheme any app can claim. 404 rather than 403: a door that
     is not ready should not advertise itself. */
  const shut = () => testEnv({ NATIVE_AUTH_ENABLED: undefined });

  it('does not mint', async () => {
    const url = new URL('https://api.test/api/auth/native/code');
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ state: STATE, codeChallenge: CHALLENGE }),
    });
    expect((await handleSession(request, shut(), url, {}))?.status).toBe(404);
  });

  it('does not exchange', async () => {
    const url = new URL('https://api.test/api/auth/native/token');
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x', state: STATE, codeVerifier: VERIFIER }),
    });
    expect((await handleSession(request, shut(), url, {}))?.status).toBe(404);
  });

  /* And a magic link must not carry native params while the doors are shut,
     or consuming it returns someone to a handoff page with nothing behind it. */
  it('does not carry native params into the login token', async () => {
    const url = new URL('https://api.test/api/auth/request');
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'native-owner@example.com', native: true, state: STATE, codeChallenge: CHALLENGE,
      }),
    });
    await handleSession(request, shut(), url, {});
    const rows = await asApp((sql) => sql<{ native_state: string | null }[]>`
      select native_state from login_token order by created_at desc limit 1`);
    expect(rows[0]?.native_state ?? null).toBeNull();
  });
});
