import { describe, expect, it } from 'vitest';
import { dailyBrief, malaysiaDay } from '@/lib/daily-brief';
import type { Activity, BusinessSnapshot, WorkSummary } from '@/lib/repo';

const now = new Date('2026-09-08T17:00:00Z'); // 1am on 9 September in Malaysia.
const known = { facts: [{ confirmed: true }] } as BusinessSnapshot;
function work(id: string, status: string, occurredAt: string): WorkSummary {
  return { id, runId: id, status, occurredAt, objective: id, outcome: null, function: null, channel: null, subject: null, minutesSaved: null, outcomeQuality: null, qualityAt: null };
}
function activity(rows: WorkSummary[], needsYou = 0, handled = 12): Activity {
  return { work: rows, counters: { needsYou, handled, minutesSaved: 100, thisWeek: 5, connections: 1 } };
}
describe('daily brief from real records', () => {
  it('uses the Malaysia day boundary, including when the browser would still be on yesterday', () => {
    expect(malaysiaDay(new Date('2026-09-08T15:59:59Z'))).toBe('2026-09-08');
    expect(malaysiaDay(new Date('2026-09-08T16:00:00Z'))).toBe('2026-09-09');
    const rows = [work('yesterday', 'completed', '2026-09-08T15:59:59Z'), work('midnight', 'completed', '2026-09-08T16:00:00Z')];
    expect(dailyBrief(activity(rows), known, now).today.map((w) => w.id)).toEqual(['midnight']);
  });
  it('sorts without mutating the feed and excludes invalid and future timestamps', () => {
    const rows = [work('first', 'completed', '2026-09-08T16:10:00Z'), work('invalid', 'completed', 'bad'), work('future', 'failed', '2026-09-09T01:00:00Z'), work('second', 'completed', '2026-09-08T16:30:00Z')];
    const brief = dailyBrief(activity(rows), known, now);
    expect(brief.today.map((w) => w.id)).toEqual(['second', 'first']);
    expect(rows.map((w) => w.id)).toEqual(['first', 'invalid', 'future', 'second']);
    expect(brief.priority).toBe('ready');
  });
  it('prioritises the authoritative approval count even when no matching work is in the feed', () => {
    expect(dailyBrief(activity([], 4), known, now)).toMatchObject({ priority: 'approval', today: [] });
    expect(dailyBrief(activity([work('failed', 'failed', now.toISOString())], 1), known, now).priority).toBe('approval');
  });
  it('keeps running work from an earlier day actionable without placing it in today’s records', () => {
    const pending = work('pending', 'working', '2026-09-07T01:00:00Z');
    expect(dailyBrief(activity([pending]), known, now)).toEqual({ priority: 'working', focus: pending, today: [] });
  });
  it('only promotes recent failed work, not an old failure or an unknown status', () => {
    const old = work('old', 'failed', '2026-09-07T01:00:00Z');
    const current = work('current', 'blocked', now.toISOString());
    expect(dailyBrief(activity([old, current]), known, now).focus).toBe(current);
    expect(dailyBrief(activity([old, work('unknown', 'mystery', now.toISOString())]), known, now).priority).toBe('ready');
  });
  it('suggests knowledge only when facts are unconfirmed, and otherwise offers the first real chat', () => {
    expect(dailyBrief(activity([], 0, 0), { facts: [{ confirmed: false }] } as BusinessSnapshot, now).priority).toBe('knowledge');
    expect(dailyBrief(activity([], 0, 0), known, now).priority).toBe('first');
    expect(dailyBrief(activity([], 0, 12), known, now).priority).toBe('ready');
  });
  it('does not turn all-time counters into today’s work or invent records outside the feed', () => {
    const result = dailyBrief(activity([], 0, 900), known, now);
    expect(result.today).toEqual([]);
    expect(result).not.toHaveProperty('completedToday');
  });
});
