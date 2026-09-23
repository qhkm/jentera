import type { Env } from '../env';

/** Everything the public booking pages may touch, and nothing more: no
    credential key, vault, email, billing or runtime binding. Code the sites
    entry imports is typed against this, so reaching for more is a compile
    error, not a secret that happens to be unset. */
export type SitesEnv = Pick<Env,
  'HYPERDRIVE' | 'APPS_ENABLED' | 'APPS_BUSINESS_IDS' | 'SITES_ORIGIN' |
  'TURNSTILE_SECRET' | 'TURNSTILE_SITE_KEY' | 'BOOKING_BURST' | 'SITES_BURST'>;
