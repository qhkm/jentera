import type { Env } from '../env';

/**
 * Placement spike (2026-09-10). Queue consumers and crons are not placed;
 * whether a request they make to the worker's own hostname is served by a
 * placed invocation decides the "placed slice" design
 * (docs/plans/2026-09-10-business-runtime-durable-object.md). Two probes:
 * `/cdn-cgi/trace` answers from the edge nearest the caller, so its colo is
 * where the caller runs; `/api/support/placement` answers from wherever the
 * worker's fetch handler ran. Logged, never awaited on the reply path.
 * Remove with the spike.
 */
export async function probePlacement(env: Env, from: 'queue' | 'cron'): Promise<void> {
  const key = env.AISAR_SUPPORT_KEY?.trim();
  if (!key || !env.API_ORIGIN) return;
  const started = Date.now();
  const out: Record<string, unknown> = { from };
  try {
    const trace = await fetch(`${env.API_ORIGIN}/cdn-cgi/trace`, {
      signal: AbortSignal.timeout(5_000),
    });
    const text = await trace.text();
    out.callerColo = /^colo=(\w+)$/m.exec(text)?.[1] ?? null;
    out.traceMs = Date.now() - started;
  } catch (error) {
    out.traceError = error instanceof Error ? error.message : String(error);
  }
  const placedStarted = Date.now();
  try {
    const placed = await fetch(`${env.API_ORIGIN}/api/support/placement`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    const body = await placed.json() as { colo?: unknown };
    out.placedColo = typeof body.colo === 'string' ? body.colo : null;
    out.placedStatus = placed.status;
    out.placedMs = Date.now() - placedStarted;
  } catch (error) {
    out.placedError = error instanceof Error ? error.message : String(error);
  }
  console.info('[placement-probe]', JSON.stringify(out));
}
