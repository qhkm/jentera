import { beforeEach, describe, expect, it } from 'vitest';
import {
  hashToken,
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
