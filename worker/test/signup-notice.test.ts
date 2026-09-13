/* ============================================================
   The owner hears about every new account, and about nothing else.
   ============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, fetchFake, req, testEnv, truncateAll } from './harness';
import { handleSession } from '../src/routes/session';
import { signupNoticeText } from '../src/signup-notice';
import { DUMMY_HASH } from '../src/password';

const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };
const OWNER = 'qhkmdev90@gmail.com';

function env(over: Record<string, unknown> = {}) {
  return testEnv({
    RESEND_API_KEY: 'resend-test-key',
    APP_ORIGIN: 'https://jentera.ai',
    SIGNUP_NOTICE_TO: OWNER,
    ...over,
  });
}

/** Every Resend send, as { to, subject, text }. */
function sent(fetchMock: ReturnType<typeof fetchFake>) {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).includes('api.resend.com'))
    .map(([, init]) => JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string });
}

function signup(email: string) {
  const { request, url } = req('POST', '/api/auth/signup', { body: { email, password: 'correct horse battery' } });
  request.headers.set('CF-Connecting-IP', '203.0.113.9');
  return { request, url };
}

describe('signup notice text', () => {
  it('names the address, the door, the verified state, the time in Malaysia and the running count', () => {
    const notice = signupNoticeText({
      email: 'someone@example.com',
      door: 'google',
      verified: true,
      at: new Date('2026-09-13T01:42:00Z'),
      accounts: 24,
    });
    expect(notice.subject).toBe('New Jentera signup: someone@example.com');
    expect(notice.text).toBe(
      'someone@example.com signed up with Google (address verified)\n' +
      '13 Sep 2026, 09:42 MYT\n' +
      'Accounts now: 24',
    );
  });

  it('says when a password signup is still waiting on its link', () => {
    const notice = signupNoticeText({
      email: 'p@example.com', door: 'password', verified: false, at: new Date('2026-09-13T01:42:00Z'), accounts: 1,
    });
    expect(notice.text).toContain('signed up with a password (address not yet verified)');
  });
});

describe('the signup notice route behaviour', () => {
  let fetchMock: ReturnType<typeof fetchFake>;

  beforeEach(async () => {
    await truncateAll();
    fetchMock = fetchFake(async () => Response.json({ id: 'email-id' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells the owner once when a password signup makes a new account', async () => {
    const { request, url } = signup('newcomer@example.com');
    const response = await handleSession(request, env(), url, cors);
    expect(response?.status).toBe(202);

    const notices = sent(fetchMock).filter((m) => m.to.includes(OWNER));
    expect(notices).toHaveLength(1);
    expect(notices[0].subject).toBe('New Jentera signup: newcomer@example.com');
    expect(notices[0].text).toContain('signed up with a password (address not yet verified)');
    expect(notices[0].text).toContain('Accounts now: 1');
  });

  it('stays silent when the address already has an account', async () => {
    await asOwner(
      (sql) => sql`insert into app_user (email, password_hash, email_verified)
                   values ('taken@example.com', ${DUMMY_HASH}, true)`,
    );
    const { request, url } = signup('taken@example.com');
    const response = await handleSession(request, env(), url, cors);
    expect(response?.status).toBe(202);

    expect(sent(fetchMock).filter((m) => m.to.includes(OWNER))).toHaveLength(0);
  });

  it('sends nothing when no address is configured', async () => {
    const { request, url } = signup('quiet@example.com');
    await handleSession(request, env({ SIGNUP_NOTICE_TO: undefined }), url, cors);

    expect(sent(fetchMock).filter((m) => m.to.includes(OWNER))).toHaveLength(0);
  });
});
