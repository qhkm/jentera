/**
 * Run stream event vocabulary, shared by the RunStream Durable Object, the
 * publisher and tests. Kept out of run-stream.ts so it can be imported
 * without `cloudflare:workers`.
 *
 * Lifecycle events are stored and replayed to late subscribers. Live events
 * (the agent's status line, a bounded slice of its reasoning, answer text as
 * it is produced) are broadcast to whoever is connected right now and never
 * stored: Postgres holds the durable answer, and a reconnecting client falls
 * back to it.
 */
export const RUN_PROGRESS_TYPES = [
  'queued',
  'waking',
  'working',
  'retrying',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RunProgressType = (typeof RUN_PROGRESS_TYPES)[number];

export const RUN_LIVE_TYPES = ['status', 'thinking', 'delta'] as const;
export type RunLiveType = (typeof RUN_LIVE_TYPES)[number];

export interface RunProgressEvent {
  version: 1;
  seq: number;
  type: RunProgressType;
  at: string;
}

export interface RunLiveEvent {
  version: 1;
  seq: 0;
  type: RunLiveType;
  at: string;
  detail?: string;
  text?: string;
}

/** Status and reasoning lines are read at a glance; answer text is capped so
    the publish body stays under the object's 2 KB request bound. */
export const LIVE_DETAIL_MAX = 240;
export const LIVE_TEXT_MAX = 1_500;

export function isRunLiveType(value: unknown): value is RunLiveType {
  return typeof value === 'string' && (RUN_LIVE_TYPES as readonly string[]).includes(value);
}

/** The reviewed shape of a live event, or null. status and thinking carry
    `detail`; delta carries `text`; anything else, or an empty payload, is
    not an event. */
export function liveEvent(body: Record<string, unknown>): RunLiveEvent | null {
  if (!isRunLiveType(body.type)) return null;
  const at = new Date().toISOString();
  if (body.type === 'delta') {
    const text = typeof body.text === 'string' ? body.text.slice(0, LIVE_TEXT_MAX) : '';
    return text ? { version: 1, seq: 0, type: 'delta', at, text } : null;
  }
  const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, LIVE_DETAIL_MAX) : '';
  return detail ? { version: 1, seq: 0, type: body.type, at, detail } : null;
}
