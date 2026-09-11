import { beforeEach, describe, expect, it } from 'vitest';
import { generateVapidJwk } from '../src/push/crypto';
import { pushToUser } from '../src/push/send';
import { savePushSubscription } from '../src/push/subscriptions';
import { asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};
let userA = '';
let jwk = '';

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    const [a] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${a.id}, ${A}, 'owner')`;
    userA = a.id;
  });
  jwk = await generateVapidJwk();
});

describe('pushToUser', () => {
  it('reaches every device the owner subscribed and forgets the ones the service says are gone', async () => {
    await asTenant(A, async (tx) => {
      await savePushSubscription(tx, A, userA, { endpoint: 'https://push.example/alive', ...KEYS, userAgent: 'phone' });
      await savePushSubscription(tx, A, userA, { endpoint: 'https://push.example/gone', ...KEYS, userAgent: 'old laptop' });
    });
    const fetch = fetchFake((input) => new Response(null, { status: String(input).endsWith('/gone') ? 410 : 201 }));
    const env = testEnv({ VAPID_PRIVATE_JWK: jwk, VAPID_SUBJECT: 'mailto:admin@kitakodventures.com' });

    const result = await pushToUser(env, A, userA, { title: 'Weekly summary is ready', body: 'Three things need you.', url: '/app?view=notifications' }, { fetch });
    expect(result).toEqual({ sent: 1, removed: 1, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    const left = await asTenant(A, (tx) => tx<{ endpoint: string; last_used_at: Date | null }[]>`select endpoint, last_used_at from push_subscription`);
    expect(left.map((row) => row.endpoint)).toEqual(['https://push.example/alive']);
    expect(left[0].last_used_at).not.toBeNull();
  });

  it('does nothing, quietly, when push is not configured or the owner has no devices', async () => {
    const fetch = fetchFake(() => new Response(null, { status: 201 }));
    expect(await pushToUser(testEnv(), A, userA, { title: 'x', body: 'y' }, { fetch })).toEqual({ sent: 0, removed: 0, failed: 0 });
    const env = testEnv({ VAPID_PRIVATE_JWK: jwk, VAPID_SUBJECT: 'mailto:admin@kitakodventures.com' });
    expect(await pushToUser(env, A, userA, { title: 'x', body: 'y' }, { fetch })).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('counts a push service outage as failed and keeps the device', async () => {
    await asTenant(A, (tx) => savePushSubscription(tx, A, userA, { endpoint: 'https://push.example/flaky', ...KEYS }));
    const fetch = fetchFake(() => new Response('try later', { status: 503 }));
    const env = testEnv({ VAPID_PRIVATE_JWK: jwk, VAPID_SUBJECT: 'mailto:admin@kitakodventures.com' });
    expect(await pushToUser(env, A, userA, { title: 'x', body: 'y' }, { fetch })).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(await asTenant(A, (tx) => tx`select id from push_subscription`)).toHaveLength(1);
  });
});
