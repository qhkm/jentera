import type { Env } from '../env';
import {
  getRuntime,
  getRuntimeSecrets,
  markRuntimeReady,
  markRuntimeState,
  recordProviderRuntime,
  removeRuntimeRecord,
  type AgentRuntimeRecord,
} from '../agent-runtime';
import { withTenant } from '../db';
import type { ObservedRuntime, RuntimeProvider } from './provider';
import { ensureProviderRuntime, runtimeProviderFor } from './provision';
import { RunnerClient } from './runner-client';
import { OpenRouterKeyManager, runtimeModelKeyNeedsRotation } from './openrouter-keys';

export async function upgradeRuntime(
  env: Env,
  businessId: string,
  provider?: RuntimeProvider,
  fetcher?: typeof globalThis.fetch,
): Promise<AgentRuntimeRecord> {
  await withTenant(env, businessId, (tx) => markRuntimeState(tx, businessId, 'upgrading'));
  return ensureProviderRuntime(env, businessId, { provider, fetch: fetcher });
}

export async function reconcileRuntime(
  env: Env,
  businessId: string,
  providerInput?: RuntimeProvider,
  fetcher?: typeof globalThis.fetch,
): Promise<AgentRuntimeRecord> {
  const current = await withTenant(env, businessId, (tx) => getRuntime(tx, businessId));
  if (!current?.providerId || !current.providerUrl) {
    return ensureProviderRuntime(env, businessId, { provider: providerInput, fetch: fetcher });
  }
  if (current.observedRelease !== current.desiredRelease) {
    return upgradeRuntime(env, businessId, providerInput, fetcher);
  }
  if (await runtimeModelKeyNeedsRotation(env, businessId)) {
    return upgradeRuntime(env, businessId, providerInput, fetcher);
  }

  const provider = providerInput ?? runtimeProviderFor(env);
  if (provider.id !== current.provider) throw new Error('runtime provider mismatch');
  const target = observed(current);
  let status = await provider.status(target);
  if (status.state === 'error') {
    if (!current.latestCheckpointId) throw new Error('runtime has no recoverable checkpoint');
    await provider.restore(target, current.latestCheckpointId);
    status = await provider.wake(target);
  } else {
    status = await provider.wake(status);
  }

  const secrets = await withTenant(env, businessId, (tx) =>
    getRuntimeSecrets(env, tx, businessId));
  const client = new RunnerClient({
    origin: status.url,
    runnerKey: secrets.runnerKey,
    edgeToken: current.provider === 'fly-sprite' ? env.SPRITES_TOKEN : undefined,
    fetch: fetcher,
  });
  const readiness = await client.ready();
  await withTenant(env, businessId, async (tx) => {
    await recordProviderRuntime(tx, businessId, status);
    await markRuntimeReady(
      tx,
      businessId,
      current.desiredRelease,
      current.latestCheckpointId!,
    );
  });
  const ready = await withTenant(env, businessId, (tx) => getRuntime(tx, businessId));
  if (!ready) throw new Error('runtime disappeared after reconciliation');
  return { ...ready, observedRegion: readiness.region };
}

export async function deleteRuntime(
  env: Env,
  businessId: string,
  providerInput?: RuntimeProvider,
): Promise<void> {
  const current = await withTenant(env, businessId, async (tx) => {
    const runtime = await getRuntime(tx, businessId);
    if (runtime) await markRuntimeState(tx, businessId, 'deleting');
    return runtime;
  });
  if (!current) return;
  if (current.providerId && current.providerUrl) {
    const provider = providerInput ?? runtimeProviderFor(env);
    if (provider.id !== current.provider) throw new Error('runtime provider mismatch');
    await provider.destroy(observed(current));
  }
  const modelKeyHashes = [
    current.modelKeyHash,
    current.modelKeyPendingRevocationHash,
  ].filter((hash): hash is string => Boolean(hash));
  if (modelKeyHashes.length) {
    const managementKey = env.AISAR_OPENROUTER_MANAGEMENT_KEY?.trim() ?? '';
    if (!managementKey) throw new Error('OpenRouter management key is required for revocation');
    const manager = new OpenRouterKeyManager(managementKey);
    for (const hash of new Set(modelKeyHashes)) await manager.revoke(hash);
  }
  await withTenant(env, businessId, (tx) => removeRuntimeRecord(tx, businessId));
}

function observed(runtime: {
  provider: ObservedRuntime['provider'];
  providerId: string | null;
  providerName: string;
  providerUrl: string | null;
  status: ObservedRuntime['state'];
}): ObservedRuntime {
  if (!runtime.providerId || !runtime.providerUrl) throw new Error('provider runtime is incomplete');
  return {
    provider: runtime.provider,
    id: runtime.providerId,
    name: runtime.providerName,
    url: runtime.providerUrl,
    state: runtime.status,
  };
}
