/* ============================================================
   Where a sprite actually is.

   The runner reports `FLY_REGION`, which does not exist inside a sprite,
   so `RUNTIME_EXPECTED_REGION` has never once been compared against a
   value (migration 063). The sprite cannot answer this about itself — it
   has no Fly metadata and its own `/info` socket returns id, name, url and
   version — but it calls this worker constantly with its own credential,
   and on those requests `request.cf` describes the caller.

   So the location is read off calls that already happen: the model proxy,
   the config channel, the artifact upload. No runner change, and therefore
   no bundle pin and no fleet release.

   Everything here is best effort by construction. A sprite's location
   changes when it is rebuilt, not between requests, so a write that is
   skipped or lost costs nothing — and nothing in this file may delay or
   fail the request it rode in on.
   ============================================================ */

import type { Env } from '../env';
import { withTenant, withUser } from '../db';
import { recordRuntimeEgress } from '../agent-runtime';

/** A sprite does not move. Re-reading its location more often than this is
 *  spending a write to learn what we already know. */
const RECORD_EVERY_MS = 6 * 60 * 60 * 1000;

/** Isolate-local and deliberately not shared: losing it on eviction costs
 *  one redundant write, and coordinating it would cost a read per call. */
const lastRecorded = new Map<string, number>();

/** Only for tests: the interval below is isolate-local, so a suite that
 *  records twice for one sprite would otherwise see the second call
 *  silently do nothing. */
export function forgetEgressMemory(): void {
  lastRecorded.clear();
}

export interface EgressDeferral {
  waitUntil?: (promise: Promise<unknown>) => void;
}

interface SeenEgress {
  colo: string;
  country: string | null;
}

/** What our own edge saw of the caller, or null when it saw nothing
 *  usable. `T1` is Cloudflare's marker for Tor, not a country. */
export function seenEgress(request: Request): SeenEgress | null {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf;
  const colo = typeof cf?.colo === 'string' ? cf.colo.trim().toLowerCase() : '';
  if (!/^[a-z]{3}$/.test(colo)) return null;
  const country = typeof cf?.country === 'string' ? cf.country.trim().toUpperCase() : '';
  return { colo, country: /^[A-Z]{2}$/.test(country) && country !== 'T1' ? country : null };
}

/** True when this caller is due a write, and claims the slot if so, so two
 *  concurrent requests from one sprite do not both write. */
function due(key: string, now: number): boolean {
  const last = lastRecorded.get(key);
  if (last !== undefined && now - last < RECORD_EVERY_MS) return false;
  lastRecorded.set(key, now);
  return true;
}

async function write(env: Env, businessId: string, egress: SeenEgress, key: string): Promise<void> {
  try {
    await withTenant(env, businessId, (tx) => recordRuntimeEgress(tx, businessId, egress));
  } catch (err) {
    /* Let the next call try again rather than waiting out the interval on
       a write that never landed. */
    lastRecorded.delete(key);
    console.warn('egress record failed', businessId, String(err));
  }
}

/** Record against a business we have already identified. */
export function recordEgress(
  env: Env,
  request: Request,
  businessId: string,
  defer: EgressDeferral = {},
): void {
  const egress = seenEgress(request);
  if (!egress || !defer.waitUntil || !due(businessId, Date.now())) return;
  defer.waitUntil(write(env, businessId, egress, businessId));
}

/** Record against a runtime credential's rider — the sprite's own name —
 *  resolving the business only on the calls that are actually due one, so
 *  the model proxy pays a lookup a few times a day rather than per call. */
export function recordEgressForRider(
  env: Env,
  request: Request,
  rider: string,
  defer: EgressDeferral = {},
): void {
  const egress = seenEgress(request);
  if (!egress || !defer.waitUntil || !rider || !due(rider, Date.now())) return;
  defer.waitUntil((async () => {
    let businessId: string | null | undefined;
    try {
      businessId = await withUser(env, async (sql) => {
        const [row] = await sql<{ business_id: string | null }[]>`
          select public.runtime_business_for_rider(${rider}) as business_id`;
        return row?.business_id;
      });
    } catch (err) {
      lastRecorded.delete(rider);
      console.warn('egress rider lookup failed', rider, String(err));
      return;
    }
    if (!businessId) return;
    await write(env, businessId, egress, rider);
  })());
}
