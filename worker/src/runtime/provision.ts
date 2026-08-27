/* ============================================================
   The first half of provisioning: claim and create compute.

   This function intentionally does not install Hermes and does not
   mark the business `hermes-sprite`. A provider resource is not a
   ready agent. Bootstrap, authenticated readiness, and a baseline
   checkpoint form the second half and must all succeed first.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import {
  claimRuntime,
  markRuntimeFailed,
  recordProviderRuntime,
  runtimeName,
  type AgentRuntimeRecord,
} from '../agent-runtime';
import { FlySpriteProvider } from './fly-sprite-provider';
import type { RuntimeProvider } from './provider';

export interface ProvisionOptions {
  provider?: RuntimeProvider;
  runnerKey?: string;
  hermesApiKey?: string;
}

export function runtimeProviderFor(env: Env): RuntimeProvider {
  if (!env.SPRITES_TOKEN) throw new Error('SPRITES_TOKEN is not configured');
  return new FlySpriteProvider({
    token: env.SPRITES_TOKEN,
    apiOrigin: env.SPRITES_API_ORIGIN,
  });
}

/**
 * Ensure a business has a provider resource and persist its identity.
 * Safe to retry after every partial failure.
 */
export async function ensureProviderRuntime(
  env: Env,
  businessId: string,
  options: ProvisionOptions = {},
): Promise<AgentRuntimeRecord> {
  const release = env.RUNTIME_RELEASE?.trim();
  if (!release) throw new Error('RUNTIME_RELEASE is not configured');

  const provider = options.provider ?? runtimeProviderFor(env);
  const name = await runtimeName(businessId);
  const runnerKey = options.runnerKey ?? randomKey();
  const hermesApiKey = options.hermesApiKey ?? randomKey();

  const claimed = await withTenant(env, businessId, (tx) =>
    claimRuntime(env, tx, businessId, {
      provider: provider.id,
      providerName: name,
      release,
      runnerKey,
      hermesApiKey,
    }),
  );
  if (claimed.provider !== provider.id) {
    throw new Error(
      `runtime is claimed by ${claimed.provider}; refusing provider switch to ${provider.id}`,
    );
  }

  try {
    const observed = await provider.create({
      businessId,
      name: claimed.providerName,
      release: claimed.desiredRelease,
    });
    return await withTenant(env, businessId, (tx) =>
      recordProviderRuntime(tx, businessId, observed),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(env, businessId, (tx) => markRuntimeFailed(tx, businessId, message));
    throw error;
  }
}

function randomKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
