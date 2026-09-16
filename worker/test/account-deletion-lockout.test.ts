import { beforeEach, describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { asOwner, jsonOf, testEnv, truncateAll } from './harness';
import { verifySession } from '../src/auth';
import { handleSession } from '../src/routes/session';

/* The container belongs to test/global-setup.ts. Never start or stop it here. */

/* Fakes the token exchange so the Google door can be driven end to end
   without a real OAuth round trip — same approach as trial-auth.test.ts. */
vi.mock('../src/oauth', async (original) => ({
  ...(await original<typeof import('../src/oauth')>()),
  exchangeCode: vi.fn(async () => ({
    subject: 'test-google-locked3',
    email: 'locked3@example.com',
    emailVerified: true,
    name: 'Locked Three',
  })),
}));

beforeEach(async () => {
  await truncateAll();
});

describe('an account being deleted', () => {
  it('cannot authenticate with a session that was valid a moment ago', async () => {
    const env = testEnv();

    await asOwner(async (owner) => {
      const { token, userId } = await seedSignedInUser(owner, 'locked@example.com');

      expect(await verifySession(env, token)).not.toBeNull();
      await owner`update app_user set deleted_at = now() where id = ${userId}`;
      expect(await verifySession(env, token)).toBeNull();
    });
  });

  it.each(['/api/auth/request', '/api/auth/signup', '/api/auth/login'])(
    'refuses %s for that address and names the way back',
    async (path) => {
      const env = testEnv();
      await asOwner((owner) => seedDeletingUser(owner, 'locked2@example.com'));

      const response = await handleSession(
        new Request(`https://api.jentera.ai${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://jentera.ai' },
          body: JSON.stringify({ email: 'locked2@example.com', password: 'hunter2hunter2' }),
        }),
        env,
        new URL(`https://api.jentera.ai${path}`),
        {},
      );

      expect(response!.status).toBe(409);
      const body = await jsonOf<{ code: string; err: string }>(response!);
      expect(body.code).toBe('ACCOUNT_DELETING');
      /* The password door otherwise refuses to say whether an address
         exists. This is the deliberate exception: whoever is typing is
         almost always the owner changing their mind, and saying nothing
         strands them for seven days. */
      expect(body.err).toMatch(/being deleted/i);
    },
  );

  it('refuses the Google callback for that address and sends it back with the reason', async () => {
    const env = testEnv({ GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test' });
    await asOwner((owner) => seedDeletingUser(owner, 'locked3@example.com'));

    const startUrl = new URL('https://api.jentera.ai/api/auth/google');
    const start = (await handleSession(
      new Request(startUrl, { method: 'POST', headers: { Origin: 'https://jentera.ai' } }),
      env,
      startUrl,
      {},
    ))!;
    const cookie = start.headers.get('Set-Cookie')!.split(';')[0];
    const state = new URL(start.headers.get('Location')!).searchParams.get('state');

    const callbackUrl = new URL(
      `https://api.jentera.ai/api/auth/google/callback?state=${state}&code=fake`,
    );
    const response = (await handleSession(
      new Request(callbackUrl, { headers: { Cookie: cookie } }),
      env,
      callbackUrl,
      {},
    ))!;

    expect(response.status).toBe(302);
    /* The callback is a browser navigation, not a fetch — it cannot answer
       409 JSON. It refuses the same way every other Google-door failure
       does: a redirect back to sign-in naming the reason. */
    expect(response.headers.get('Location')).toBe(`${env.APP_ORIGIN}/signin?error=account-deleting`);
  });
});

async function seedSignedInUser(owner: postgres.Sql, email: string) {
  const [user] = await owner`
    insert into app_user (email, email_verified) values (${email}, true) returning id`;
  const token = 'tok-' + email;
  const id = await sha256Hex(token);
  await owner`
    insert into session (id, user_id, expires_at) values (${id}, ${user.id}, now() + interval '30 days')`;
  return { token, userId: user.id as string };
}

async function seedDeletingUser(owner: postgres.Sql, email: string) {
  const [user] = await owner`
    insert into app_user (email, email_verified, deleted_at) values (${email}, true, now()) returning id`;
  return user.id as string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
