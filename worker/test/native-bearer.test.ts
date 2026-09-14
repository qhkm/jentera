import { beforeEach, describe, expect, it } from 'vitest';
import { readSessionToken, verifySession } from '../src/auth';
import { handleSupport } from '../src/routes/support';
import { asOwner, signIn, testEnv, truncateAll } from './harness';

const BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
let token: string;
let cookie: string;

beforeEach(async () => {
  await truncateAll();
  const userId = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${BUSINESS_ID}, 'Kedai', 'restaurant')`;
    const [user] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('owner@example.com', true)
      returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${user.id}, ${BUSINESS_ID}, 'owner')`;
    return user.id;
  });
  cookie = await signIn(userId);
  token = cookie.replace(/^aisar_session=/, '').split(';')[0];
});

describe('reading a session token from a request', () => {
  it('takes the Authorization header', () => {
    const request = new Request('https://api.test/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readSessionToken(request)).toBe(token);
  });

  it('still takes the cookie', () => {
    const request = new Request('https://api.test/api/me', {
      headers: { Cookie: cookie },
    });
    expect(readSessionToken(request)).toBe(token);
  });

  /* Android's WebView shares the system cookie jar, so a stale Set-Cookie
     from api.jentera.ai must not shadow the token the app actually holds. */
  it('prefers the header when both are present', () => {
    const request = new Request('https://api.test/api/me', {
      headers: { Authorization: 'Bearer header-wins', Cookie: cookie },
    });
    expect(readSessionToken(request)).toBe('header-wins');
  });

  it('ignores a malformed Authorization header', () => {
    const request = new Request('https://api.test/api/me', {
      headers: { Authorization: token },
    });
    expect(readSessionToken(request)).toBeNull();
  });

  it('authenticates a real session presented as a bearer', async () => {
    const request = new Request('https://api.test/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const identity = await verifySession(testEnv(), readSessionToken(request)!);
    expect(identity?.businessId).toBe(BUSINESS_ID);
  });
});

describe('a session bearer is not a service credential', () => {
  it('is refused at the support routes', async () => {
    const request = new Request('https://api.test/api/support/runtime-slice', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const response = await handleSupport(
      request,
      testEnv({ AISAR_SUPPORT_KEY: 'support-only-secret' }),
      new URL(request.url),
      {},
    );
    expect(response?.status).toBe(401);
  });
});
