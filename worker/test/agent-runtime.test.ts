import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimRuntime,
  getRuntime,
  getRuntimeSecrets,
  markRuntimeFailed,
  markRuntimeReady,
  recordProviderRuntime,
  runtimeName,
} from '../src/agent-runtime';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';
import { ensureProviderRuntime, LocalRuntimeProvider } from '../src/runtime';
import type { DesiredRuntime, ObservedRuntime, RuntimeProvider } from '../src/runtime';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const env = testEnv();

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'salon')`;
  });
});

describe('the runtime control-plane record', () => {
  it('uses a stable opaque provider name', async () => {
    const a = await runtimeName(A);
    expect(a).toMatch(/^aisar-b-[0-9a-f]{20}$/);
    expect(a).toBe(await runtimeName(A));
    expect(a).not.toBe(await runtimeName(B));
    expect(a).not.toContain(A.slice(0, 8));
  });

  it('claims exactly one row for a business', async () => {
    const name = await runtimeName(A);
    await asTenant(A, (tx) =>
      claimRuntime(env, tx, A, {
        provider: 'fly-sprite', providerName: name,
        release: '2026.08.27-1', runnerKey: 'first-runner',
        hermesApiKey: 'first-hermes',
      }),
    );
    await asTenant(A, (tx) =>
      claimRuntime(env, tx, A, {
        provider: 'fly-sprite', providerName: name,
        release: '2026.08.28-1', runnerKey: 'second-runner',
        hermesApiKey: 'second-hermes',
      }),
    );

    const rows = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from agent_runtime where business_id = ${A}`);
    expect(rows[0].count).toBe('1');
    expect((await asTenant(A, (tx) => getRuntime(tx, A)))?.desiredRelease)
      .toBe('2026.08.28-1');
    await expect(asTenant(A, (tx) => getRuntimeSecrets(env, tx, A)))
      .resolves.toEqual({ runnerKey: 'first-runner', hermesApiKey: 'first-hermes' });
  });

  it('is invisible to another tenant even when it guesses the id', async () => {
    await claim(A);
    expect(await asTenant(B, (tx) => getRuntime(tx, A))).toBeNull();
  });

  it('records provider identity without declaring Hermes ready', async () => {
    const claimed = await claim(A);
    const row = await asTenant(A, (tx) =>
      recordProviderRuntime(tx, A, {
        provider: 'fly-sprite', id: 'sprite-id', name: claimed.providerName,
        url: `https://${claimed.providerName}.example`, state: 'cold',
      }),
    );
    expect(row.providerId).toBe('sprite-id');
    expect(row.status).toBe('cold');

    const [business] = await asOwner((sql) => sql<{ runtime: string }[]>`
      select runtime from business where id = ${A}`);
    expect(business.runtime).toBe('aisar-native');
  });

  it('switches the business only after readiness and a baseline checkpoint', async () => {
    await claim(A);
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    const runtime = await asTenant(A, (tx) => getRuntime(tx, A));
    expect(runtime?.status).toBe('ready');
    expect(runtime?.observedRelease).toBe('2026.08.27-1');
    expect(runtime?.latestCheckpointId).toBe('v1');

    const [business] = await asOwner((sql) => sql<{ runtime: string }[]>`
      select runtime from business where id = ${A}`);
    expect(business.runtime).toBe('hermes-sprite');
  });

  it('keeps a bounded, recoverable failure', async () => {
    await claim(A);
    await asTenant(A, (tx) => markRuntimeFailed(tx, A, 'x'.repeat(2000)));
    const runtime = await asTenant(A, (tx) => getRuntime(tx, A));
    expect(runtime?.status).toBe('error');
    expect(runtime?.lastError).toHaveLength(1000);
  });
});

describe('provider provisioning', () => {
  it('creates and records compute without prematurely selecting Hermes', async () => {
    const runtimeEnv = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const row = await ensureProviderRuntime(runtimeEnv, A, {
      provider: new LocalRuntimeProvider(),
      runnerKey: 'test-runner-key',
      hermesApiKey: 'test-runtime-key',
    });
    expect(row.provider).toBe('local');
    expect(row.providerId).toBeTruthy();
    expect(row.status).toBe('cold');

    const [business] = await asOwner((sql) => sql<{ runtime: string }[]>`
      select runtime from business where id = ${A}`);
    expect(business.runtime).toBe('aisar-native');
  });

  it('is idempotent across retries', async () => {
    const runtimeEnv = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const provider = new LocalRuntimeProvider();
    const first = await ensureProviderRuntime(runtimeEnv, A, { provider });
    const second = await ensureProviderRuntime(runtimeEnv, A, { provider });
    expect(second.id).toBe(first.id);
    expect(second.providerId).toBe(first.providerId);
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from agent_runtime where business_id = ${A}`);
    expect(count).toBe('1');
  });

  it('records a recoverable provider failure', async () => {
    const broken: RuntimeProvider = {
      id: 'local',
      create: async (_desired: DesiredRuntime) => { throw new Error('capacity unavailable'); },
      wake: async (runtime: ObservedRuntime) => runtime,
      stop: async () => {},
      status: async (runtime: ObservedRuntime) => runtime,
      checkpoint: async () => 'v1',
      restore: async () => {},
      destroy: async () => {},
    };
    await expect(
      ensureProviderRuntime(testEnv({ RUNTIME_RELEASE: '2026.08.27-1' }), A, {
        provider: broken,
      }),
    ).rejects.toThrow('capacity unavailable');
    const row = await asTenant(A, (tx) => getRuntime(tx, A));
    expect(row?.status).toBe('error');
    expect(row?.lastError).toBe('capacity unavailable');
  });

  it('refuses to silently move a claimed runtime between providers', async () => {
    const runtimeEnv = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    await ensureProviderRuntime(runtimeEnv, A, { provider: new LocalRuntimeProvider() });
    const pretendingToBeFly = {
      ...new LocalRuntimeProvider(),
      id: 'fly-sprite' as const,
    } as unknown as RuntimeProvider;
    await expect(ensureProviderRuntime(runtimeEnv, A, { provider: pretendingToBeFly }))
      .rejects.toThrow(/refusing provider switch/);
  });
});

async function claim(businessId: string) {
  const name = await runtimeName(businessId);
  return asTenant(businessId, (tx) =>
    claimRuntime(env, tx, businessId, {
      provider: 'fly-sprite',
      providerName: name,
      release: '2026.08.27-1',
      runnerKey: 'runner-secret',
      hermesApiKey: 'runtime-secret',
    }),
  );
}
