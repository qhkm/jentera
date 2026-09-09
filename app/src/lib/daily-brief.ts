import type { Activity, BusinessSnapshot, WorkSummary } from '@/lib/repo';

export const BUSINESS_TIME_ZONE = 'Asia/Kuala_Lumpur';
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function malaysiaDay(value: Date): string {
  const parts = dayFormat.formatToParts(value);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}

export type BriefPriority = 'approval' | 'failed' | 'working' | 'knowledge' | 'first' | 'ready';

/** A deterministic brief, not an agent-generated report. occurredAt is the
 * record date, not necessarily when a task completed. Never call these daily
 * totals: Activity is capped at the 50 most recent records. */
export function dailyBrief(activity: Activity, snapshot: BusinessSnapshot, now: Date): {
  priority: BriefPriority;
  focus?: WorkSummary;
  today: WorkSummary[];
} {
  const day = malaysiaDay(now);
  const recent = activity.work
    .filter((work) => {
      const time = Date.parse(work.occurredAt);
      return Number.isFinite(time) && time <= now.getTime();
    })
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const today = recent.filter((work) => malaysiaDay(new Date(work.occurredAt)) === day);
  if (activity.counters.needsYou > 0) return { priority: 'approval', today };
  const failed = today.find((work) => work.status === 'failed' || work.status === 'blocked');
  if (failed) return { priority: 'failed', focus: failed, today };
  const working = recent.find((work) => ['queued', 'working', 'running'].includes(work.status));
  if (working) return { priority: 'working', focus: working, today };
  if (!snapshot.facts.some((fact) => fact.confirmed)) return { priority: 'knowledge', today };
  if (activity.counters.handled === 0) return { priority: 'first', today };
  return { priority: 'ready', today };
}
