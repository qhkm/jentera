import type { Env } from '../env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_APPS_PILOTS = 20;

/** The apps pilot list. Like desktop view and unlike routines: an empty list
    means nobody, there is no wildcard, and one malformed id turns the whole
    list off rather than guessing. */
export function appsEnabledFor(env: Pick<Env, 'APPS_ENABLED' | 'APPS_BUSINESS_IDS'>, businessId: string): boolean {
  if (env.APPS_ENABLED !== 'true' || !UUID.test(businessId)) return false;
  const ids = (env.APPS_BUSINESS_IDS ?? '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
  return ids.length > 0 && ids.length <= MAX_APPS_PILOTS && ids.every((id) => UUID.test(id)) &&
    ids.includes(businessId.toLowerCase());
}
