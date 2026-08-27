import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimRuntime,
  getRuntimeModelCredential,
  runtimeName,
  storeRuntimeModelCredential,
} from '../src/agent-runtime';
import { OpenRouterKeyManager, runtimeModelKey } from '../src/runtime/openrouter-keys';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '99999999-9999-4999-8999-999999999999';
const HASH = 'a'.repeat(64);
const INFERENCE_KEY = `sk-or-v1-${'b'.repeat(64)}`;
const MANAGEMENT_KEY = `sk-or-mgmt-${'c'.repeat(64)}`;

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

describe('per-runtime OpenRouter keys', () => {
  it('creates the reviewed capped key shape and revokes by hash', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      seen.push({ url: String(input), init });
      if (init.method === 'DELETE') return Response.json({ deleted: true });
      return Response.json({
        key: INFERENCE_KEY,
        data: {
          hash: HASH,
          expires_at: '2026-11-26T00:00:00.000Z',
          limit: 5,
          limit_reset: 'monthly',
          include_byok_in_limit: true,
        },
      }, { status: 201 });
    };
    const manager = new OpenRouterKeyManager(MANAGEMENT_KEY, fetcher);
    await expect(manager.create('aisar-b-0123456789abcdef0123', new Date('2026-08-28T00:00:00Z')))
      .resolves.toEqual({ key: INFERENCE_KEY, hash: HASH, expiresAt: new Date('2026-11-26T00:00:00Z') });
    const body = JSON.parse(String(seen[0].init.body));
    expect(body).toEqual({
      name: 'aisar-b-0123456789abcdef0123',
      limit: 5,
      limit_reset: 'monthly',
      include_byok_in_limit: true,
      expires_at: '2026-11-26T00:00:00.000Z',
    });
    expect(new Headers(seen[0].init.headers).get('Authorization'))
      .toBe(`Bearer ${MANAGEMENT_KEY}`);
    await manager.revoke(HASH);
    expect(seen[1].url).toBe(`https://openrouter.ai/api/v1/keys/${HASH}`);
    expect(seen[1].init.method).toBe('DELETE');
  });

  it('refuses a created key whose returned controls do not match the request', async () => {
    const fetcher: typeof fetch = async () => Response.json({
      key: INFERENCE_KEY,
      data: {
        hash: HASH,
        expires_at: '2026-11-26T00:00:00.000Z',
        limit: 50,
        limit_reset: 'monthly',
        include_byok_in_limit: true,
      },
    }, { status: 201 });
    const manager = new OpenRouterKeyManager(MANAGEMENT_KEY, fetcher);
    await expect(manager.create(
      'aisar-b-0123456789abcdef0123',
      new Date('2026-08-28T00:00:00Z'),
    )).rejects.toThrow('invalid model credential');
  });

  it('encrypts a newly issued key and reuses it without another API call', async () => {
    const env = testEnv({ AISAR_OPENROUTER_MANAGEMENT_KEY: MANAGEMENT_KEY });
    const name = await runtimeName(A);
    await asTenant(A, (tx) => claimRuntime(env, tx, A, {
      provider: 'fly-sprite', providerName: name, release: '2026.08.28-3',
      runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
    }));
    const manager = {
      create: vi.fn(async () => ({
        key: INFERENCE_KEY,
        hash: HASH,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      })),
      revoke: vi.fn(async () => {}),
    } as unknown as OpenRouterKeyManager;

    expect(await runtimeModelKey(env, A, name, { manager })).toBe(INFERENCE_KEY);
    expect(await runtimeModelKey(env, A, name, { manager })).toBe(INFERENCE_KEY);
    expect(manager.create).toHaveBeenCalledTimes(1);
    const stored = await asTenant(A, (tx) => getRuntimeModelCredential(env, tx, A));
    expect(stored).toMatchObject({ key: INFERENCE_KEY, hash: HASH });
    const [raw] = await asOwner((sql) => sql<{ model_key_ciphertext: Uint8Array }[]>`
      select model_key_ciphertext from agent_runtime where business_id = ${A}`);
    expect(new TextDecoder().decode(raw.model_key_ciphertext)).not.toContain(INFERENCE_KEY);
  });

  it('allows the shared bridge only for an explicitly named canary', async () => {
    const name = await runtimeName(A);
    const env = testEnv({
      AISAR_MODEL_KEY: 'legacy-canary-inference-key',
      RUNTIME_SHARED_MODEL_KEY_BUSINESS_IDS: A,
    });
    await asTenant(A, (tx) => claimRuntime(env, tx, A, {
      provider: 'fly-sprite', providerName: name, release: '2026.08.28-3',
      runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
    }));
    await expect(runtimeModelKey(env, A, name)).resolves.toBe('legacy-canary-inference-key');
    await expect(runtimeModelKey(
      testEnv({ AISAR_MODEL_KEY: 'legacy-canary-inference-key' }), A, name,
    )).rejects.toThrow(/issuance is unavailable/);
  });

  it('durably retries revocation if rotation cleanup initially fails', async () => {
    const env = testEnv({ AISAR_OPENROUTER_MANAGEMENT_KEY: MANAGEMENT_KEY });
    const name = await runtimeName(A);
    await asTenant(A, async (tx) => {
      await claimRuntime(env, tx, A, {
        provider: 'fly-sprite', providerName: name, release: '2026.08.28-3',
        runnerKey: 'r'.repeat(64), hermesApiKey: 'h'.repeat(64),
      });
      await storeRuntimeModelCredential(env, tx, A, {
        key: `sk-or-v1-${'d'.repeat(64)}`,
        hash: 'e'.repeat(64),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
    });
    const manager = {
      create: vi.fn(async () => ({
        key: INFERENCE_KEY,
        hash: HASH,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      })),
      revoke: vi.fn()
        .mockRejectedValueOnce(new Error('temporary OpenRouter failure'))
        .mockResolvedValue(undefined),
    } as unknown as OpenRouterKeyManager;

    await expect(runtimeModelKey(env, A, name, { manager }))
      .rejects.toThrow('temporary OpenRouter failure');
    const pending = await asTenant(A, (tx) => getRuntimeModelCredential(env, tx, A));
    expect(pending).toMatchObject({
      key: INFERENCE_KEY,
      hash: HASH,
      pendingRevocationHash: 'e'.repeat(64),
    });

    await expect(runtimeModelKey(env, A, name, { manager })).resolves.toBe(INFERENCE_KEY);
    expect(manager.create).toHaveBeenCalledTimes(1);
    const cleaned = await asTenant(A, (tx) => getRuntimeModelCredential(env, tx, A));
    expect(cleaned?.pendingRevocationHash).toBeNull();
  });
});
