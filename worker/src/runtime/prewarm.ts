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
export type PrewarmOutcome = 'prewarm_ready' | 'prewarm_rejected' | 'prewarm_failed';

export async function prewarmSprite(
  runtimeUrl: string,
  token: string,
  report: (outcome: PrewarmOutcome, extra: Record<string, unknown>) => void = () => {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL('/healthz', runtimeUrl);
  } catch {
    return;
  }
  /* Never forward the organization Sprite token to an arbitrary stored URL. */
  if (url.protocol !== 'https:' ||
      (url.hostname !== 'sprites.app' && !url.hostname.endsWith('.sprites.app'))) {
    return;
  }
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    report(response.ok ? 'prewarm_ready' : 'prewarm_rejected', { status: response.status });
  } catch (error) {
    report('prewarm_failed', { error: error instanceof Error ? error.name : 'unknown' });
  }
}
