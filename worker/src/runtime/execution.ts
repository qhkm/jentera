import type { Env } from '../env';

/** Explicit tenant canary gate for paid, externally hosted execution. */
export function runtimeExecutionEnabled(env: Env, businessId: string): boolean {
  return new Set((env.RUNTIME_EXECUTION_BUSINESS_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(uuid))
    .has(businessId);
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
