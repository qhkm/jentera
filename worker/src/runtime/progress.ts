import type { Env } from '../env';
import type { RunLiveType, RunProgressType } from '../run-stream-events';

export interface RunProgressExtra {
  /** status / thinking: one line the owner can read at a glance. */
  detail?: string;
  /** delta: answer text as the model produces it. */
  text?: string;
}

/** Best-effort realtime projection. Postgres remains authoritative if this layer fails. */
export async function publishRunProgress(
  env: Env,
  businessId: string,
  runId: string,
  type: RunProgressType | RunLiveType,
  extra: RunProgressExtra = {},
): Promise<void> {
  if (!env.RUN_STREAMS) return;
  const id = env.RUN_STREAMS.idFromName(`${businessId}:${runId}`);
  const response = await env.RUN_STREAMS.get(id).fetch('https://run-stream.internal/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessId,
      runId,
      type,
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
      ...(extra.text === undefined ? {} : { text: extra.text }),
    }),
  });
  if (!response.ok) throw new Error(`run stream refused progress (${response.status})`);
}

export async function publishRunProgressSafely(
  env: Env,
  businessId: string,
  runId: string,
  type: RunProgressType | RunLiveType,
  extra: RunProgressExtra = {},
): Promise<void> {
  try {
    await publishRunProgress(env, businessId, runId, type, extra);
  } catch {
    /* Never interpolate DO errors: the realtime view must not become a new secret sink. */
    console.error('[run-stream] progress publish failed');
  }
}
