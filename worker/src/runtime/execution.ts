import type { Env } from '../env';
import type { AgentRuntimeRecord } from '../agent-runtime';

/** Global emergency brake. Tenant authority comes from its ready runtime row. */
export function runtimeExecutionEnabled(env: Env): boolean {
  return env.RUNTIME_EXECUTION_ENABLED === 'true';
}

export function runtimeReady(runtime: AgentRuntimeRecord | null): runtime is AgentRuntimeRecord {
  return Boolean(runtime && runtime.observedRelease === runtime.desiredRelease &&
    ['ready', 'cold', 'idle', 'busy'].includes(runtime.status));
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
  if (!env.AISAR_OPENROUTER_MANAGEMENT_KEY?.trim()) {
    return 'per-agent model credentials are not configured';
  }
  if (!env.RUNTIME_RELEASE?.trim()) return 'runtime release is not configured';
  if (!/^[0-9a-f]{40}$/.test(env.RUNTIME_BUNDLE_COMMIT?.trim() ?? '')) {
    return 'runtime bundle is not configured';
  }
  if (env.AISAR_MODEL_PROVIDER !== 'openrouter' ||
      env.AISAR_MODEL_BASE !== 'https://openrouter.ai/api/v1' ||
      !env.AISAR_MODEL_NAME?.trim()) {
    return 'runtime model is not configured';
  }
  return null;
}
