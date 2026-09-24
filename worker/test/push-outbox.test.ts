import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connect } from '../src/db';
import { generateVapidJwk } from '../src/push/crypto';
import { deliverPendingPushes, enqueuePush, PUSH_OUTBOX_MAX_ATTEMPTS, sweepPushOutbox } from '../src/push/outbox';
import { savePushSubscription } from '../src/push/subscriptions';
import { asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};
let userA = '';
let userB = '';
let jwk = '';
const NOTE = { title: 'Weekly summary is ready', body: 'Three things need you.', url: '/app?view=notifications', tag: 'notification:weekly-1' };

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'retail')`;
    const [a] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('a@example.com', true) returning id`;
    const [b] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('b@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${a.id}, ${A}, 'owner'), (${b.id}, ${B}, 'owner')`;
    userA = a.id; userB = b.id;
  });
  jwk = await generateVapidJwk();
});

const pushEnv = () => testEnv({ VAPID_PRIVATE_JWK: jwk, VAPID_SUBJECT: 'mailto:admin@kitakodventures.com' });
const outboxRows = (business: string) => asTenant(business, (tx) => tx<{
  id: string; attempts: number; delivered_at: Date | null; deliver_after: Date; last_error: string | null;
}[]>`select id, attempts, delivered_at, deliver_after, last_error from push_outbox order by created_at`);

describe('push outbox', () => {
  it('queues inside the tenant transaction and stays invisible to other tenants', async () => {
    await asTenant(A, (tx) => enqueuePush(tx, A, userA, NOTE));
    expect(await outboxRows(A)).toHaveLength(1);
    expect(await outboxRows(B)).toHaveLength(0);
    /* The due scan is the one cross-tenant read, and it hands back only ids. */
    const sql = connect(pushEnv());
    try {
      const due = await sql<{ business_id: string; outbox_id: string }[]>`
        select business_id, outbox_id from public.push_outbox_due(now(), 50)`;
      expect(due).toEqual([{ business_id: A, outbox_id: (await outboxRows(A))[0].id }]);
    } finally {
      await sql.end();
    }
  });

  it('delivers a queued notification to every device the owner subscribed and marks it done', async () => {
    await asTenant(A, async (tx) => {
      await savePushSubscription(tx, A, userA, { endpoint: 'https://push.example/a1', ...KEYS });
      await enqueuePush(tx, A, userA, NOTE);
    });
    const fetch = fetchFake(() => new Response(null, { status: 201 }));
    const result = await sweepPushOutbox(pushEnv(), { fetch });
    expect(result).toEqual({ delivered: 1, retried: 0, gaveUp: 0 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe('https://push.example/a1');
    const [row] = await outboxRows(A);
    expect(row.delivered_at).not.toBeNull();
    expect(row.attempts).toBe(1);
    /* Nothing left to do on the next tick. */
    expect(await sweepPushOutbox(pushEnv(), { fetch })).toEqual({ delivered: 0, retried: 0, gaveUp: 0 });
  });

  it('retries with growing delay while the push service is down, then delivers', async () => {
    await asTenant(A, async (tx) => {
      await savePushSubscription(tx, A, userA, { endpoint: 'https://push.example/a1', ...KEYS });
      await enqueuePush(tx, A, userA, NOTE);
    });
    const down = fetchFake(() => new Response('try later', { status: 503 }));
    expect(await sweepPushOutbox(pushEnv(), { fetch: down })).toEqual({ delivered: 0, retried: 1, gaveUp: 0 });
    let [row] = await outboxRows(A);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toMatch(/503/);
    expect(row.deliver_after.getTime()).toBeGreaterThan(Date.now() + 30_000);

    /* Not due yet: the sweep leaves it alone. */
    expect(await sweepPushOutbox(pushEnv(), { fetch: down })).toEqual({ delivered: 0, retried: 0, gaveUp: 0 });

    const later = new Date(Date.now() + 10 * 60_000);
    const up = fetchFake(() => new Response(null, { status: 201 }));
    expect(await sweepPushOutbox(pushEnv(), { fetch: up, now: later })).toEqual({ delivered: 1, retried: 0, gaveUp: 0 });
    [row] = await outboxRows(A);
    expect(row.delivered_at).not.toBeNull();
  });

  it('counts an owner with no devices as delivered, with nothing sent', async () => {
    await asTenant(A, (tx) => enqueuePush(tx, A, userA, NOTE));
    const fetch = fetchFake(() => new Response(null, { status: 201 }));
    expect(await sweepPushOutbox(pushEnv(), { fetch })).toEqual({ delivered: 1, retried: 0, gaveUp: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect((await outboxRows(A))[0].delivered_at).not.toBeNull();
  });

  it('gives up after the last attempt and says why, instead of retrying forever', async () => {
    await asTenant(A, async (tx) => {
      await savePushSubscription(tx, A, userA, { endpoint: 'https://push.example/a1', ...KEYS });
      await enqueuePush(tx, A, userA, NOTE);
    });
    await asOwner((sql) => sql`update push_outbox set attempts = ${PUSH_OUTBOX_MAX_ATTEMPTS - 1}`);
    const down = fetchFake(() => new Response('nope', { status: 500 }));
    expect(await sweepPushOutbox(pushEnv(), { fetch: down })).toEqual({ delivered: 0, retried: 0, gaveUp: 1 });
    const [row] = await outboxRows(A);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(PUSH_OUTBOX_MAX_ATTEMPTS);
    expect(row.last_error).toMatch(/gave up/i);
    expect(await sweepPushOutbox(pushEnv(), { fetch: down })).toEqual({ delivered: 0, retried: 0, gaveUp: 0 });
  });

  it('leaves the queue untouched when push is not configured', async () => {
    await asTenant(A, (tx) => enqueuePush(tx, A, userA, NOTE));
    const fetch = fetchFake(() => new Response(null, { status: 201 }));
    expect(await sweepPushOutbox(testEnv(), { fetch })).toEqual({ delivered: 0, retried: 0, gaveUp: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect((await outboxRows(A))[0].delivered_at).toBeNull();
    expect(userB).toBeTruthy();
  });
});

describe('sending a business\'s pushes now, not at the next cron tick', () => {
  const subscribe = (business: string, user: string, endpoint: string) => asTenant(business, async (tx) => {
    await savePushSubscription(tx, business, user, { endpoint, ...KEYS });
    await enqueuePush(tx, business, user, NOTE);
  });

  it('delivers what that business has queued, and leaves nothing for the cron', async () => {
    await subscribe(A, userA, 'https://push.example/a1');
    const fetch = fetchFake(() => new Response(null, { status: 201 }));
    expect(await deliverPendingPushes(pushEnv(), A, { fetch })).toEqual({ delivered: 1, retried: 0, gaveUp: 0 });
    expect(fetch).toHaveBeenCalledOnce();
    expect((await outboxRows(A))[0].delivered_at).not.toBeNull();
    expect(await sweepPushOutbox(pushEnv(), { fetch })).toEqual({ delivered: 0, retried: 0, gaveUp: 0 });
  });

  it('touches no other business', async () => {
    await subscribe(B, userB, 'https://push.example/b1');
    const fetch = fetchFake(() => new Response(null, { status: 201 }));
    expect(await deliverPendingPushes(pushEnv(), A, { fetch })).toEqual({ delivered: 0, retried: 0, gaveUp: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect((await outboxRows(B))[0].delivered_at).toBeNull();
  });

  it('sends a push once when the cron sweeps at the same moment', async () => {
    await subscribe(A, userA, 'https://push.example/a1');
    const fetch = fetchFake(async () => {
      /* Hold the send open so both paths are in flight together. */
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(null, { status: 201 });
    });
    const [now, cron] = await Promise.all([
      deliverPendingPushes(pushEnv(), A, { fetch }),
      sweepPushOutbox(pushEnv(), { fetch }),
    ]);
    expect(now.delivered + cron.delivered).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('hands a failed send back to the cron to retry', async () => {
    await subscribe(A, userA, 'https://push.example/a1');
    const down = fetchFake(() => new Response('try later', { status: 503 }));
    expect(await deliverPendingPushes(pushEnv(), A, { fetch: down })).toEqual({ delivered: 0, retried: 1, gaveUp: 0 });
    const [row] = await outboxRows(A);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(1);
    const later = new Date(Date.now() + 10 * 60_000);
    const up = fetchFake(() => new Response(null, { status: 201 }));
    expect(await sweepPushOutbox(pushEnv(), { fetch: up, now: later })).toEqual({ delivered: 1, retried: 0, gaveUp: 0 });
  });

  it('judges due by the database clock, so a Worker clock running behind still sends at once', async () => {
    await subscribe(A, userA, 'https://push.example/a1');
    /* The row was stamped by the database; this Worker's clock reads five
       seconds earlier, so by its reckoning the push is not due yet. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 5_000);
    try {
      const fetch = fetchFake(() => new Response(null, { status: 201 }));
      expect(await deliverPendingPushes(pushEnv(), A, { fetch })).toEqual({ delivered: 1, retried: 0, gaveUp: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when push is not configured', async () => {
    await subscribe(A, userA, 'https://push.example/a1');
    const fetch = fetchFake(() => new Response(null, { status: 201 }));
    expect(await deliverPendingPushes(testEnv(), A, { fetch })).toEqual({ delivered: 0, retried: 0, gaveUp: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
