import type { Env } from '../env';
import type { AgentRuntimeRecord } from '../agent-runtime';
import { RUNTIME_PROXY_PATH } from '../fmcv-verifier';

/** Global emergency brake. Tenant authority comes from its ready runtime row. */
export function runtimeExecutionEnabled(env: Env): boolean {
  return env.RUNTIME_EXECUTION_ENABLED === 'true';
}

export function runtimeReady(runtime: AgentRuntimeRecord | null): runtime is AgentRuntimeRecord {
  return Boolean(runtime && runtime.observedRelease === runtime.desiredRelease &&
    ['ready', 'cold', 'idle', 'busy'].includes(runtime.status));
}

/** Upstream model gateways the model proxy may forward to. Provider-neutral:
    swapping gateways is configuration (this list + FMCV_UPSTREAM_KEY), never
    a code change. */
const ALLOWED_MODEL_BASES = new Set([
  'https://openrouter.ai/api/v1',
  'https://router.fmcv.my',
]);

export function runtimeModelBaseAllowed(value: string | undefined): boolean {
  return ALLOWED_MODEL_BASES.has(value?.trim() ?? '');
}

/** The base handed to runtimes: either an allowlisted upstream directly, or
    this Worker's own model proxy, which forwards to the allowlisted upstream
    while verifying and metering the runtime credential. Only the official
    OpenRouter endpoint may be faced directly (management-key credentialing);
    every other upstream goes through this Worker's proxy at
    API_ORIGIN + RUNTIME_PROXY_PATH, which is what runtimeFacingModelBaseAllowed
    accepts for anything that is not OpenRouter. */
export function runtimeFacingModelBase(env: Env): string {
  const explicit = env.AISAR_RUNTIME_MODEL_BASE?.trim();
  if (explicit) return explicit;
  const upstream = env.AISAR_MODEL_BASE?.trim() ?? '';
  if (!upstream) return '';
  if (upstream === 'https://openrouter.ai/api/v1') return upstream;
  const origin = (env.API_ORIGIN ?? '').replace(/\/+$/, '');
  return origin ? `${origin}${RUNTIME_PROXY_PATH}` : '';
}

/** What a runtime may be pointed at. Direct access is allowed only to the
    official OpenRouter endpoint (management-key credentialing); everything
    else must go through this Worker's model proxy so the credential is a
    signed jentera token verified here. The legacy direct-FMCV mode is gone
    with the host-side verifier prototype. */
export function runtimeFacingModelBaseAllowed(env: Env, value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return false;
  if (trimmed === 'https://openrouter.ai/api/v1') return true;
  const origin = (env.API_ORIGIN ?? '').replace(/\/+$/, '');
  return origin.length > 0 && trimmed === `${origin}${RUNTIME_PROXY_PATH}`;
}

/**
 * Validate every prerequisite before onboarding promises an agent. Keeping
 * this synchronous means the business write and task enqueue can remain one
 * tenant-scoped database transaction.
 */
export function runtimeProvisioningProblem(env: Env): string | null {
  if (env.RUNTIME_PROVISIONING_ENABLED !== 'true') return 'runtime provisioning is disabled';
  if (env.MODEL_TRANSPORT_READY !== 'true') return 'secure model transport is not ready';
  if (env.RUNTIME_BOOTSTRAP_ENABLED !== 'true') return 'production runtime bootstrap is disabled';
  if (env.RUNTIME_EXECUTION_ENABLED !== 'true') return 'runtime execution is disabled';
  if (!env.RUNTIME_QUEUE) return 'runtime queue is not configured';
  if (!env.SPRITES_TOKEN?.trim()) return 'Sprite provisioning is not configured';
  if (!env.RUNTIME_RELEASE?.trim()) return 'runtime release is not configured';
  if (!/^[0-9a-f]{40}$/.test(env.RUNTIME_BUNDLE_COMMIT?.trim() ?? '')) {
    return 'runtime bundle is not configured';
  }
  const modelBase = env.AISAR_MODEL_BASE?.trim() ?? '';
  const runtimeBase = runtimeFacingModelBase(env);
  if (env.AISAR_MODEL_PROVIDER?.trim() !== 'openrouter' ||
      !runtimeModelBaseAllowed(modelBase) ||
      !runtimeFacingModelBaseAllowed(env, runtimeBase) ||
      !env.AISAR_MODEL_NAME?.trim()) {
    return 'runtime model is not configured';
  }
  const proxyMode = runtimeBase !== modelBase;
  if (proxyMode) {
    /* The proxy signs runtime credentials from the control secret and
       presents FMCV_UPSTREAM_KEY to the upstream — both required. */
    if ((env.AISAR_MODEL_KEY?.trim() ?? '').length < 32) {
      return 'model control secret is not configured';
    }
    if (!env.FMCV_UPSTREAM_KEY?.trim()) {
      return 'model upstream credential is not configured';
    }
  } else if (!env.AISAR_OPENROUTER_MANAGEMENT_KEY?.trim()) {
    return 'per-agent model credentials are not configured';
  }
  return null;
}
