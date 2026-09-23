/**
 * Wake a business's Sprite ahead of the work that needs it.
 *
 * Any authenticated request to the sprite's URL resumes it; /healthz is the
 * cheapest. The Telegram webhook does this under the Queue handoff so the
 * cold wake overlaps the durable admission, and the chat page does it as it
 * opens so the first message finds a warm sprite. Sprites pause again about
 * 15 s after activity stops, and a warm resume is sub-second with Hermes
 * still loaded, so this converts a cold wake into a warm one at no standing
 * cost.
 */
export type PrewarmOutcome = 'prewarm_ready' | 'prewarm_rejected' | 'prewarm_failed' | 'prewarm_skipped';

/** What the attempt did, durable rather than only logged: a first reply that
    was slow despite a ready warm is not a wake problem, and one with no warm
    at all is a trigger that did not fire or fired too late. */
/** How long the probe waits for a sprite to answer.
 *
 * This was 8000 ms, and that number sat inside the cold-wake distribution
 * rather than beyond it. Measured across the fleet on 23 September: every
 * failure was at exactly 8000 ms — not one was a refusal or a connection
 * error — while the slowest success took 6927 ms, 87% of the budget. So the
 * probe was abandoning wakes it had itself started, recording them as
 * failures, and leaving the owner's next message to pay the remainder. One
 * owner waited 10.9 s that way.
 *
 * A cold wake costs 15-30 s. Nothing user-facing waits on this — the route
 * answers 202 and runs the probe in `ctx.waitUntil` — so the only real
 * ceiling is that tail. Wait for the wake instead of giving up a third of
 * the way in. */
export const PREWARM_TIMEOUT_MS = 25_000;

export interface PrewarmResult {
  outcome: PrewarmOutcome;
  ms: number;
}

export async function prewarmSprite(
  runtimeUrl: string,
  token: string,
  report: (outcome: PrewarmOutcome, extra: Record<string, unknown>) => void = () => {},
): Promise<PrewarmResult> {
  const startedAt = Date.now();
  let url: URL;
  try {
    url = new URL('/healthz', runtimeUrl);
  } catch {
    return { outcome: 'prewarm_skipped', ms: 0 };
  }
  /* Never forward the organization Sprite token to an arbitrary stored URL. */
  if (url.protocol !== 'https:' ||
      (url.hostname !== 'sprites.app' && !url.hostname.endsWith('.sprites.app'))) {
    return { outcome: 'prewarm_skipped', ms: 0 };
  }
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
    });
    const outcome: PrewarmOutcome = response.ok ? 'prewarm_ready' : 'prewarm_rejected';
    const ms = Date.now() - startedAt;
    report(outcome, { status: response.status, ms });
    return { outcome, ms };
  } catch (error) {
    const ms = Date.now() - startedAt;
    report('prewarm_failed', { error: error instanceof Error ? error.name : 'unknown', ms });
    return { outcome: 'prewarm_failed', ms };
  }
}
