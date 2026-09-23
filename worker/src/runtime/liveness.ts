/* ============================================================
   Looking at every sprite, on the cron that already visits them.

   `agent_runtime.status` is written when something succeeds and never when
   anything stops, so it is a record of the last good moment rather than a
   statement about now. On 23 September three sprites unreachable since the
   18th still read `error`, `error` and `upgrading`, and a fourth read `ready`
   about a host whose filesystem Fly had already condemned. Nobody was told
   for five days.

   This records a second opinion beside the first. It changes no status,
   publishes no task, and tells nobody — deliberately. The thresholds that
   decide "unhealthy" come from a week of these outcomes, because the one
   number in hand said a probe calibrated by intuition would call a healthy
   fleet dead: five of seven prewarms were failing at exactly the old 8000 ms
   budget, while the slowest success took 6927 ms.

   docs/plans/2026-09-23-runtime-liveness.md is the contract.
   ============================================================ */

import type { Env } from '../env';
import { connect } from '../db';
import { prewarmSprite } from './prewarm';

/** What one look concluded. Mirrors the check constraint in migration 067;
    anything else is refused by the database rather than stored. */
export type LivenessOutcome = 'reachable' | 'unreachable' | 'corrupt' | 'skipped';

interface LivenessTarget {
  runtime_id: string;
  business_id: string;
  provider: string;
  provider_name: string | null;
  provider_url: string | null;
}

/** How many sprites one pass looks at. The fleet is 17; this leaves room to
    grow without letting a single cron invocation run unbounded. Targets come
    back longest-unlooked-at first, so a fleet past this size is still covered
    across successive passes rather than the same head of the list. */
const LIVENESS_BATCH = 100;

export async function sweepRuntimeLiveness(env: Env): Promise<number> {
  const token = env.SPRITES_TOKEN?.trim();
  /* No token, no probe. Recording every sprite as unreachable because we
     cannot ask would be worse than recording nothing. */
  if (!token) return 0;

  const sql = connect(env);
  try {
    const targets = await sql<LivenessTarget[]>`
      select runtime_id, business_id, provider, provider_name, provider_url
        from public.runtime_liveness_targets(${LIVENESS_BATCH})`;

    let looked = 0;
    for (const target of targets) {
      /* Nothing to ask. Manufacturing an outage out of a missing field would
         put a healthy business into the alerting path for a data problem. */
      if (!target.provider_url || target.provider !== 'fly-sprite') continue;

      const outcome = await lookAt(target.provider_url, token);
      /* One sprite's failure must not end the pass: the sprite most worth
         looking at is the one most likely to throw. */
      await sql`select public.record_runtime_liveness(${target.runtime_id}, ${outcome})`
        .catch(() => undefined);
      looked += 1;
    }
    return looked;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Reachable means the host answered, not that it answered happily. A sprite
    returning 503 is up and talking, and calling that unreachable would make
    one signal mean two things — the confusion this whole file exists to end. */
async function lookAt(providerUrl: string, token: string): Promise<LivenessOutcome> {
  try {
    const { outcome } = await prewarmSprite(providerUrl, token);
    if (outcome === 'prewarm_ready' || outcome === 'prewarm_rejected') return 'reachable';
    if (outcome === 'prewarm_skipped') return 'skipped';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}
