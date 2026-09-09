import type { Env } from '../env';

/**
 * Routines v1 is advertised to a tenant only when the flag is on and, if an
 * allowlist is set, the business is on it. The same answer gates every
 * write and every dispatch, so the frontend's discovery and the backend's
 * enforcement cannot disagree. With the flag off, existing routines stay
 * readable and pausable but nothing new is admitted.
 */
export function routinesEnabledFor(env: Env, businessId: string): boolean {
  if (env.ROUTINES_ENABLED?.trim() !== 'true') return false;
  const allow = (env.AISAR_ROUTINES_BUSINESS_IDS ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  return allow.length === 0 || allow.includes(businessId.toLowerCase());
}
