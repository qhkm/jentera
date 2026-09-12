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

  it('bootstraps a pinned release before selecting Hermes for the business', async () => {
    class BootstrapLocalProvider extends LocalRuntimeProvider {
      writes: { path: string; data: string; mode: number }[] = [];
      commands: { command: string; args: string[] }[] = [];

      async writeFile(_runtime: ObservedRuntime, path: string, data: string, mode: number) {
        this.writes.push({ path, data, mode });
      }

      async exec(_runtime: ObservedRuntime, command: string, args: string[] = []) {
        this.commands.push({ command, args });
        return { exitCode: 0, stdout: '{"ok":true}', stderr: '' };
      }
    }
    const provider = new BootstrapLocalProvider();
    const runtimeEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      RUNTIME_BOOTSTRAP_ENABLED: 'true',
      RUNTIME_BUNDLE_COMMIT: 'a'.repeat(40),
      AISAR_MODEL_PROVIDER: 'openrouter',
      AISAR_MODEL_BASE: 'https://router.fmcv.my',
      AISAR_MODEL_KEY: 'fmcv-control-secret-'.padEnd(48, 's'),
      AISAR_MODEL_NAME: 'MiniMax-M3',
    });
    const row = await ensureProviderRuntime(runtimeEnv, A, {
      provider,
      runnerKey: 'runner-key-for-alpha'.repeat(2),
      hermesApiKey: 'hermes-key-for-alpha',
      fetch: async () => new Response(JSON.stringify({
        ok: true,
        release: '2026.08.27-1',
        runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
        hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
        toolMode: 'full-tools',
        webSearchBackend: 'ddgs',
        edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
      })),
    });
    expect(row.status).toBe('ready');
    expect(row.latestCheckpointId).toBe('v1');
    expect(provider.writes).toHaveLength(1);
    expect(provider.writes[0]).toMatchObject({
      path: '/home/sprite/aisar/bootstrap.env.in',
      mode: 0o600,
    });
    expect(provider.writes[0].data).not.toContain('fmcv-control-secret-');
    expect(provider.commands.map((entry) => entry.command)).toEqual([
      '/bin/bash', '/home/sprite/aisar/runner/bootstrap-runtime.sh',
    ]);
    const [business] = await asOwner((sql) => sql<{ runtime: string }[]>`
      select runtime from business where id = ${A}`);
    expect(business.runtime).toBe('hermes-sprite');
  });

  it('stays converged when the checkpoint fails after a healthy bootstrap, keeping the old rollback point', async () => {
    /* BoxCompute, 12 September: bootstrap and readiness pass on every
       attempt, then Fly's checkpoint rename finds an orphan directory. The
       release is real on the sprite; the control plane must say so rather
       than re-queue a failing upgrade every fifteen minutes. */
    const readyz = (release: string) => async () => new Response(JSON.stringify({
      ok: true, release,
      runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
      hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
      toolMode: 'full-tools', webSearchBackend: 'ddgs', edgeAuthorizationForwarded: false,
      specialistProfiles: { operations: true, customers: true, growth: true, records: true },
    }));
    const base = {
      RUNTIME_BOOTSTRAP_ENABLED: 'true', RUNTIME_BUNDLE_COMMIT: 'a'.repeat(40),
      AISAR_MODEL_PROVIDER: 'openrouter', AISAR_MODEL_BASE: 'https://router.fmcv.my',
      AISAR_MODEL_KEY: 'fmcv-control-secret-'.padEnd(48, 's'), AISAR_MODEL_NAME: 'MiniMax-M3',
    };
    class OrphanCheckpointProvider extends LocalRuntimeProvider {
      failCheckpoints = false;
      created = 0;
      async writeFile() {}
      async exec() { return { exitCode: 0, stdout: '{"ok":true}', stderr: '' }; }
      async checkpoint(runtime: ObservedRuntime) {
        if (this.failCheckpoints) {
          throw new Error('Failed to create checkpoint: JuiceFS rename clone: rename checkpoints/v31.in-progress checkpoints/v31: file exists');
        }
        this.created += 1;
        return super.checkpoint(runtime);
      }
    }
    const provider = new OrphanCheckpointProvider();
    const keys = { provider, runnerKey: 'runner-key-for-alpha'.repeat(2), hermesApiKey: 'hermes-key-for-alpha' };
    const first = await ensureProviderRuntime(testEnv({ ...base, RUNTIME_RELEASE: '2026.09.11-7' }), A, { ...keys, fetch: readyz('2026.09.11-7') });
    expect(first).toMatchObject({ status: 'ready', observedRelease: '2026.09.11-7', latestCheckpointId: 'v1', lastError: null });

    provider.failCheckpoints = true;
    const second = await ensureProviderRuntime(testEnv({ ...base, RUNTIME_RELEASE: '2026.09.12-2' }), A, { ...keys, fetch: readyz('2026.09.12-2') });
    expect(second.status).toBe('ready');
    expect(second.observedRelease).toBe('2026.09.12-2');
    expect(second.latestCheckpointId).toBe('v1');
    expect(second.lastError).toMatch(/checkpoint failed after a healthy bootstrap/i);
    expect(second.lastError).toMatch(/file exists/);
    const [business] = await asOwner((sql) => sql<{ runtime: string }[]>`select runtime from business where id = ${A}`);
    expect(business.runtime).toBe('hermes-sprite');

    /* The next release that can checkpoint clears the warning. */
    provider.failCheckpoints = false;
    const third = await ensureProviderRuntime(testEnv({ ...base, RUNTIME_RELEASE: '2026.09.13-1' }), A, { ...keys, fetch: readyz('2026.09.13-1') });
    expect(third).toMatchObject({ status: 'ready', observedRelease: '2026.09.13-1', lastError: null });
    expect(third.latestCheckpointId).not.toBe('v1');
  });

  it('hands candidate model routes to bootstrap and refuses invalid ids', async () => {
    const readyz = async () => new Response(JSON.stringify({
      ok: true,
      release: '2026.08.27-1',
      runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
      hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
      toolMode: 'full-tools',
      webSearchBackend: 'ddgs',
      edgeAuthorizationForwarded: false,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
    }));
    const base = {
      RUNTIME_RELEASE: '2026.08.27-1',
      RUNTIME_BOOTSTRAP_ENABLED: 'true',
      RUNTIME_BUNDLE_COMMIT: 'a'.repeat(40),
      AISAR_MODEL_PROVIDER: 'openrouter',
      AISAR_MODEL_BASE: 'https://router.fmcv.my',
      AISAR_MODEL_KEY: 'fmcv-control-secret-'.padEnd(48, 's'),
      AISAR_MODEL_NAME: 'MiniMax-M3',
      AISAR_DEEP_MODEL_NAME: 'deepseek-v4-flash',
    };
    class CandidateBootstrapProvider extends LocalRuntimeProvider {
      writes: { path: string; data: string; mode: number }[] = [];

      async writeFile(_runtime: ObservedRuntime, path: string, data: string, mode: number) {
        this.writes.push({ path, data, mode });
      }

      async exec() {
        return { exitCode: 0, stdout: '{"ok":true}', stderr: '' };
      }
    }
    const provider = new CandidateBootstrapProvider();
    await ensureProviderRuntime(
      testEnv({ ...base, AISAR_CANDIDATE_MODEL_NAMES: 'MiniMax-M2.7-highspeed' }),
      A,
      { provider, runnerKey: 'runner-key-for-alpha'.repeat(2), hermesApiKey: 'hermes-key-for-alpha', fetch: readyz },
    );
    const transfer = provider.writes[0].data as string;
    expect(transfer).toContain(
      `CANDIDATE_MODEL_NAMES_B64=${Buffer.from('MiniMax-M2.7-highspeed').toString('base64')}`,
    );

    await truncateAll();
    await asOwner((sql) => sql`
      insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
    await expect(ensureProviderRuntime(
      testEnv({ ...base, AISAR_CANDIDATE_MODEL_NAMES: 'bad model' }),
      A,
      { provider: new CandidateBootstrapProvider(), runnerKey: 'runner-key-for-alpha'.repeat(2), hermesApiKey: 'hermes-key-for-alpha', fetch: readyz },
    )).rejects.toThrow(/candidate model/);
  });

  it('does not checkpoint or select Hermes when the edge forwards its bearer token', async () => {
    class GuardedBootstrapProvider extends LocalRuntimeProvider {
      checkpointCalls = 0;

      async writeFile() {}

      async exec() {
        return { exitCode: 0, stdout: '{"ok":true}', stderr: '' };
      }

      async checkpoint(runtime: ObservedRuntime) {
        this.checkpointCalls += 1;
        return super.checkpoint(runtime);
      }
    }
    const provider = new GuardedBootstrapProvider();
    const runtimeEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      RUNTIME_BOOTSTRAP_ENABLED: 'true',
      RUNTIME_BUNDLE_COMMIT: 'a'.repeat(40),
      AISAR_MODEL_PROVIDER: 'openrouter',
      AISAR_MODEL_BASE: 'https://router.fmcv.my',
      AISAR_MODEL_KEY: 'fmcv-control-secret-'.padEnd(48, 's'),
      AISAR_MODEL_NAME: 'MiniMax-M3',
      SPRITES_TOKEN: 'organization-sprite-token',
    });

    await expect(ensureProviderRuntime(runtimeEnv, A, {
      provider,
      runnerKey: 'runner-key-for-alpha'.repeat(2),
      hermesApiKey: 'hermes-key-for-alpha',
      fetch: async () => Response.json({
        ok: true,
        release: '2026.08.27-1',
        runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
        hermes: { jenteraPatch: 'jentera-runtime-2026-09-07' },
        toolMode: 'full-tools',
        webSearchBackend: 'ddgs',
        edgeAuthorizationForwarded: true,
          specialistProfiles: { operations: true, customers: true, growth: true, records: true },
      }),
    })).rejects.toThrow('edge credential isolation');
    expect(provider.checkpointCalls).toBe(0);
    const runtime = await asTenant(A, (tx) => getRuntime(tx, A));
    expect(runtime?.status).toBe('error');
    const [business] = await asOwner((sql) => sql<{ runtime: string }[]>`
      select runtime from business where id = ${A}`);
    expect(business.runtime).toBe('aisar-native');
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
