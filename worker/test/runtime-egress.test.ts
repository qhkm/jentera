import { beforeEach, describe, expect, it } from 'vitest';
import { claimRuntime, getRuntimeEgress, getRuntimeRegion } from '../src/agent-runtime';
import { forgetEgressMemory, recordEgress, recordEgressForRider, seenEgress } from '../src/runtime/egress';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const env = testEnv();

/** A request as the edge hands it to us. */
function fromSprite(cf: Record<string, unknown> | undefined): Request {
  const request = new Request('https://api.jentera.ai/v1/model/chat/completions', { method: 'POST' });
  Object.defineProperty(request, 'cf', { value: cf, configurable: true });
  return request;
}

/** Collects the deferred work, so a test can await what the worker would
 *  have left running after the response went out. */
function deferral() {
  const pending: Promise<unknown>[] = [];
  return {
    defer: { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } },
    settle: () => Promise.all(pending),
    get count() { return pending.length; },
  };
}

async function runtimeFor(businessId: string, providerName: string) {
  await asTenant(businessId, (tx) =>
    claimRuntime(env, tx, businessId, {
      provider: 'fly-sprite', providerName,
      release: '2026.09.18-6', runnerKey: 'runner', hermesApiKey: 'hermes',
    }),
  );
}

beforeEach(async () => {
  /* The interval is per isolate, not per test. Without this, the second
     test to record a given sprite writes nothing and says nothing. */
  forgetEgressMemory();
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'salon')`;
  });
});

describe('reading a sprite location off its own calls', () => {
  it('takes the edge and the country, and refuses anything else', () => {
    expect(seenEgress(fromSprite({ colo: 'SIN', country: 'SG' }))).toEqual({ colo: 'sin', country: 'SG' });
    expect(seenEgress(fromSprite(undefined))).toBeNull();
    expect(seenEgress(fromSprite({ country: 'SG' }))).toBeNull();
    expect(seenEgress(fromSprite({ colo: 'SINGAPORE', country: 'SG' }))).toBeNull();
    /* Tor is not a country, and an edge without one is still a location. */
    expect(seenEgress(fromSprite({ colo: 'SJC', country: 'T1' }))).toEqual({ colo: 'sjc', country: null });
    expect(seenEgress(fromSprite({ colo: 'HKG' }))).toEqual({ colo: 'hkg', country: null });
  });

  it('records what the edge saw against the business', async () => {
    await runtimeFor(A, 'aisar-b-aaaaaaaaaaaaaaaaaaaa');
    const { defer, settle } = deferral();
    recordEgress(env, fromSprite({ colo: 'SJC', country: 'US' }), A, defer);
    await settle();
    const egress = await asTenant(A, (tx) => getRuntimeEgress(tx, A));
    expect(egress.colo).toBe('sjc');
    expect(egress.country).toBe('US');
    expect(egress.seenAt).toBeInstanceOf(Date);
  });

  it('writes once per sprite for the interval, however many calls arrive', async () => {
    await runtimeFor(A, 'aisar-b-aaaaaaaaaaaaaaaaaaaa');
    const first = deferral();
    recordEgress(env, fromSprite({ colo: 'SIN', country: 'SG' }), A, first.defer);
    recordEgress(env, fromSprite({ colo: 'SIN', country: 'SG' }), A, first.defer);
    recordEgress(env, fromSprite({ colo: 'SIN', country: 'SG' }), A, first.defer);
    expect(first.count).toBe(1);
    await first.settle();
  });

  it('never writes, and never defers, without somewhere to defer to', async () => {
    await runtimeFor(B, 'aisar-b-bbbbbbbbbbbbbbbbbbbb');
    recordEgress(env, fromSprite({ colo: 'LAX', country: 'US' }), B);
    expect((await asTenant(B, (tx) => getRuntimeEgress(tx, B))).colo).toBeNull();
  });

  it('resolves the business from the credential rider', async () => {
    const name = 'aisar-b-bbbbbbbbbbbbbbbbbbbb';
    await runtimeFor(B, name);
    const { defer, settle } = deferral();
    recordEgressForRider(env, fromSprite({ colo: 'LAX', country: 'US' }), name, defer);
    await settle();
    expect((await asTenant(B, (tx) => getRuntimeEgress(tx, B))).colo).toBe('lax');
  });

  it('leaves an unknown rider alone rather than guessing', async () => {
    await runtimeFor(A, 'aisar-b-aaaaaaaaaaaaaaaaaaaa');
    const { defer, settle } = deferral();
    recordEgressForRider(env, fromSprite({ colo: 'SIN', country: 'SG' }), 'aisar-b-nosuchrider0000000', defer);
    await settle();
    expect((await asTenant(A, (tx) => getRuntimeEgress(tx, A))).colo).toBeNull();
  });
});

describe('the region the app is shown', () => {
  it('prefers what the sprite showed us over the lifecycle task', async () => {
    await runtimeFor(A, 'aisar-b-aaaaaaaaaaaaaaaaaaaa');
    /* What every business actually has today: a completed task carrying an
       empty region, because the runner reports an unset FLY_REGION. */
    await asOwner(async (sql) => {
      await sql`insert into runtime_task (business_id, kind, status, dedupe_key, result, completed_at)
                values (${A}, 'provision', 'completed', 'egress-test', ${sql.json({ region: '' })}, now())`;
    });
    expect(await asTenant(A, (tx) => getRuntimeRegion(tx, A))).toBeNull();

    const { defer, settle } = deferral();
    recordEgress(env, fromSprite({ colo: 'SJC', country: 'US' }), A, defer);
    await settle();
    expect(await asTenant(A, (tx) => getRuntimeRegion(tx, A))).toBe('sjc');
  });
});
