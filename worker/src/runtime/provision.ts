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
  getRuntime,
  getRuntimeSecrets,
  markRuntimeFailed,
  markRuntimeReady,
  recordProviderRuntime,
  runtimeName,
  type AgentRuntimeRecord,
} from '../agent-runtime';
import { FlySpriteProvider } from './fly-sprite-provider';
import { canBootstrap, type BootstrapRuntimeProvider, type RuntimeProvider } from './provider';
import { finalizeRuntimeModelKeyRotation, runtimeModelKey } from './openrouter-keys';
import { RunnerClient } from './runner-client';

export interface ProvisionOptions {
  provider?: RuntimeProvider;
  runnerKey?: string;
  hermesApiKey?: string;
  fetch?: typeof globalThis.fetch;
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
    const recorded = await withTenant(env, businessId, (tx) =>
      recordProviderRuntime(tx, businessId, observed),
    );
    if (env.RUNTIME_BOOTSTRAP_ENABLED !== 'true') return recorded;
    if (!canBootstrap(provider)) throw new Error('runtime provider cannot bootstrap releases');
    return await bootstrapRuntime(env, businessId, recorded, provider, options.fetch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(env, businessId, (tx) => markRuntimeFailed(tx, businessId, message));
    throw error;
  }
}

async function bootstrapRuntime(
  env: Env,
  businessId: string,
  runtime: AgentRuntimeRecord,
  provider: BootstrapRuntimeProvider,
  fetcher?: typeof globalThis.fetch,
): Promise<AgentRuntimeRecord> {
  const commit = env.RUNTIME_BUNDLE_COMMIT?.trim() ?? '';
  const modelProvider = env.AISAR_MODEL_PROVIDER?.trim() ?? '';
  const modelBase = env.AISAR_MODEL_BASE?.trim() ?? '';
  const modelName = env.AISAR_MODEL_NAME?.trim() ?? '';
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('RUNTIME_BUNDLE_COMMIT is invalid');
  if (modelProvider !== 'openrouter') throw new Error('Jentera model provider is not allowed');
  if (!['https://openrouter.ai/api/v1', 'https://router.fmcv.my'].includes(modelBase)) {
    throw new Error('Jentera model endpoint is not pinned');
  }
  if (!/^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._:~-]+)?$/.test(modelName)) {
    throw new Error('Jentera model name is invalid');
  }
  if (!runtime.providerId || !runtime.providerUrl) throw new Error('provider runtime is incomplete');

  const modelKey = await runtimeModelKey(env, businessId, runtime.providerName);

  const secrets = await withTenant(env, businessId, (tx) =>
    getRuntimeSecrets(env, tx, businessId),
  );
  const transfer = [
    field('BUSINESS_ID_B64', businessId),
    field('RUNTIME_RELEASE_B64', runtime.desiredRelease),
    field('RUNNER_KEY_B64', secrets.runnerKey),
    field('HERMES_KEY_B64', secrets.hermesApiKey),
    field('MODEL_PROVIDER_B64', modelProvider),
    field('MODEL_BASE_B64', modelBase),
    field('MODEL_KEY_B64', modelKey),
    field('MODEL_NAME_B64', modelName),
    field('HERMES_TAG_B64', 'v2026.8.19'),
    field('HERMES_COMMIT_B64', 'fcbd1076a93841fa88855acce810e342a5b78101'),
  ].join('\n') + '\n';
  const observed = {
    provider: runtime.provider,
    id: runtime.providerId,
    name: runtime.providerName,
    url: runtime.providerUrl,
    state: runtime.status,
  } as const;
  await provider.writeFile(observed, '/home/sprite/aisar/bootstrap.env.in', transfer, 0o600);

  const raw = `https://raw.githubusercontent.com/qhkm/jentera/${commit}`;
  const assets = [
    'runner/src/server.mjs',
    'runner/bin/browser-smoke.mjs',
    'runner/bin/web-search-smoke.py',
    'runner/bin/configure-model-provider.py',
    'runner/bin/patch-hermes-dependencies.mjs',
    'runner/bin/hermes-service.sh',
    'runner/bin/runner-service.sh',
    'runner/bin/bootstrap-runtime.sh',
  ];
  const downloads = [
    'set -euo pipefail',
    'install -d -m 700 /home/sprite/aisar/runner',
    ...assets.map((asset) => {
      const target = asset.replace(/^runner\/(?:src|bin)\//, '');
      return `curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 ` +
        `'${raw}/${asset}' --output '/home/sprite/aisar/runner/${target}'`;
    }),
    'chmod 755 /home/sprite/aisar/runner/configure-model-provider.py ' +
      '/home/sprite/aisar/runner/hermes-service.sh ' +
      '/home/sprite/aisar/runner/runner-service.sh ' +
      '/home/sprite/aisar/runner/bootstrap-runtime.sh',
  ].join('\n');
  await provider.exec(observed, '/bin/bash', ['-lc', downloads]);
  await provider.exec(
    observed,
    '/home/sprite/aisar/runner/bootstrap-runtime.sh',
    ['/home/sprite/aisar/bootstrap.env.in'],
    { env: ['AISAR_BOOTSTRAP_CONTROL_PLANE=1'] },
  );
  const awakened = await provider.wake(observed);
  const client = new RunnerClient({
    origin: awakened.url,
    runnerKey: secrets.runnerKey,
    edgeToken: runtime.provider === 'fly-sprite' ? env.SPRITES_TOKEN : undefined,
    fetch: fetcher,
  });
  /* Readiness is authenticated and attests the pinned full-tools mode, a
     boot-tested web-search backend, and that Fly's edge did not forward its
     organization bearer token into the tenant. */
  const readiness = await client.ready();
  const checkpoint = await provider.checkpoint(
    awakened,
    `Jentera runtime ${runtime.desiredRelease}`,
  );
  /* Only revoke the prior inference key after the Sprite has attested and a
     known-good checkpoint containing the replacement exists. */
  await finalizeRuntimeModelKeyRotation(env, businessId);
  await withTenant(env, businessId, (tx) =>
    markRuntimeReady(tx, businessId, runtime.desiredRelease, checkpoint),
  );
  const ready = await withTenant(env, businessId, (tx) => getRuntime(tx, businessId));
  if (!ready) throw new Error('runtime disappeared after bootstrap');
  return { ...ready, observedRegion: readiness.region };
}

function field(name: string, value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${name}=${btoa(binary)}`;
}

function randomKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
