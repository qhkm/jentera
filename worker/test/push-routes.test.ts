import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handlePush } from '../src/routes/push';
import { generateVapidJwk, vapidKeysFromJwk } from '../src/push/crypto';
import { asOwner, asTenant, fetchFake, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let userA = '';
let cookieA: string;
let cookieB: string;
let jwk: string;

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-a-token';
/* A real-looking subscription: 65-byte uncompressed P-256 point and 16-byte auth secret. */
const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

beforeEach(async () => {
  await truncateAll();
  let userB = '';
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'retail')`;
    const [a] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    const [b] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('b@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${a.id}, ${A}, 'owner'), (${b.id}, ${B}, 'owner')`;
    userA = a.id; userB = b.id;
  });
  cookieA = await signIn(userA);
  cookieB = await signIn(userB);
  jwk = await generateVapidJwk();
});

function pushEnv(over: Record<string, unknown> = {}): Env {
  return testEnv({ VAPID_PRIVATE_JWK: jwk, VAPID_SUBJECT: 'mailto:admin@kitakodventures.com', ...over });
}

async function call(method: string, path: string, env: Env, cookie?: string, body?: unknown, fetch = fetchFake(() => new Response(null, { status: 201 }))) {
  const incoming = req(method, path, { cookie, body });
  const response = await handlePush(incoming.request, env, incoming.url, {}, { fetch });
  if (!response) throw new Error('push route did not match');
  return { response, fetch };
}

describe('push subscriptions', () => {
  it('publishes the VAPID public key the browser subscribes with', async () => {
    const { response } = await call('GET', '/api/push/vapid-public-key', pushEnv());
    expect(response.status).toBe(200);
    const keys = await vapidKeysFromJwk(jwk);
    expect(await jsonOf<{ key: string }>(response)).toEqual({ ok: true, key: keys.publicKey });
  });

  it('answers 503, not a broken key, when push is not configured', async () => {
    const { response } = await call('GET', '/api/push/vapid-public-key', testEnv());
    expect(response.status).toBe(503);
  });

  it('refuses a subscription without a session', async () => {
    const { response } = await call('PUT', '/api/push/subscription', pushEnv(), undefined, { endpoint: ENDPOINT, keys: KEYS });
    expect(response.status).toBe(401);
  });

  it('stores a subscription for the signed-in owner and confirms it with a first push', async () => {
    const { response, fetch } = await call('PUT', '/api/push/subscription', pushEnv(), cookieA, { endpoint: ENDPOINT, keys: KEYS });
    expect(response.status).toBe(200);
    const rows = await asTenant(A, (tx) => tx<{ user_id: string; endpoint: string }[]>`
      select user_id, endpoint from push_subscription`);
    expect(rows).toEqual([{ user_id: userA, endpoint: ENDPOINT }]);
    /* RLS: the other tenant sees nothing. */
    expect(await asTenant(B, (tx) => tx`select id from push_subscription`)).toHaveLength(0);

    expect(fetch).toHaveBeenCalledOnce();
    const [target, init] = fetch.mock.calls[0];
    expect(String(target)).toBe(ENDPOINT);
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('POST');
    expect(headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(headers.get('Content-Type')).toBe('application/octet-stream');
    expect(headers.get('TTL')).toMatch(/^\d+$/);
    expect(headers.get('Authorization')).toMatch(/^vapid t=[A-Za-z0-9_.-]+, k=B[A-Za-z0-9_-]{86}$/);
    expect((init?.body as ArrayBuffer).byteLength).toBeGreaterThan(86);
  });

  it('keeps one row per device when the browser re-sends the same endpoint', async () => {
    await call('PUT', '/api/push/subscription', pushEnv(), cookieA, { endpoint: ENDPOINT, keys: KEYS });
    await call('PUT', '/api/push/subscription', pushEnv(), cookieA, { endpoint: ENDPOINT, keys: KEYS });
    expect(await asTenant(A, (tx) => tx`select id from push_subscription`)).toHaveLength(1);
  });

  it('rejects a subscription whose keys are not the shape a push service issues', async () => {
    for (const body of [
      { endpoint: 'http://insecure.example/x', keys: KEYS },
      { endpoint: ENDPOINT, keys: { p256dh: 'short', auth: KEYS.auth } },
      { endpoint: ENDPOINT, keys: { p256dh: KEYS.p256dh, auth: 'x' } },
      { endpoint: ENDPOINT },
    ]) {
      const { response } = await call('PUT', '/api/push/subscription', pushEnv(), cookieA, body);
      expect(response.status).toBe(400);
    }
    expect(await asTenant(A, (tx) => tx`select id from push_subscription`)).toHaveLength(0);
  });

  it('removes a device on request, and only for its own owner', async () => {
    await call('PUT', '/api/push/subscription', pushEnv(), cookieA, { endpoint: ENDPOINT, keys: KEYS });
    const other = await call('DELETE', '/api/push/subscription', pushEnv(), cookieB, { endpoint: ENDPOINT });
    expect(other.response.status).toBe(200);
    expect(await asTenant(A, (tx) => tx`select id from push_subscription`)).toHaveLength(1);
    const own = await call('DELETE', '/api/push/subscription', pushEnv(), cookieA, { endpoint: ENDPOINT });
    expect(own.response.status).toBe(200);
    expect(await asTenant(A, (tx) => tx`select id from push_subscription`)).toHaveLength(0);
  });
});
