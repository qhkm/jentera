/**
 * Schedule math for Routines v1.
 *
 * A schedule is a local wall-clock time in a named IANA zone on a set of
 * weekdays. The next trigger is the first matching local time strictly after
 * a given instant: saving a form never runs immediately, and a trigger that
 * is exactly now belongs to the past. All arithmetic goes through
 * Intl.DateTimeFormat in the routine's zone, never the process zone, so the
 * Worker and the test runner agree and a second zone later is a list entry.
 */

export type Frequency = 'daily' | 'weekdays' | 'weekly';

export interface Schedule {
  frequency: Frequency;
  /** ISO weekday 1 (Monday) to 7 (Sunday); present exactly when weekly. */
  weekday?: number;
  /** Strict 24-hour HH:mm. */
  time: string;
  timeZone: string;
}

export const SUPPORTED_TIME_ZONES: readonly string[] = ['Asia/Kuala_Lumpur'];
const FREQUENCIES: readonly Frequency[] = ['daily', 'weekdays', 'weekly'];
const TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

export type ScheduleValidation =
  | { schedule: Schedule }
  | { errors: Record<string, string> };

/** Strict: unknown fields, loose times and a weekday on the wrong frequency
    are all rejected, so what is stored is exactly what was reviewed. */
export function validateSchedule(input: unknown): ScheduleValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { errors: { schedule: 'schedule must be an object' } };
  }
  const value = input as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    if (!['frequency', 'weekday', 'time', 'timeZone'].includes(key)) {
      errors[key] = 'unknown field';
    }
  }
  const frequency = value.frequency;
  if (typeof frequency !== 'string' || !FREQUENCIES.includes(frequency as Frequency)) {
    errors.frequency = 'frequency must be daily, weekdays or weekly';
  }
  const time = value.time;
  if (typeof time !== 'string' || !TIME.test(time)) {
    errors.time = 'time must be HH:mm, 00:00 to 23:59';
  }
  const timeZone = value.timeZone;
  if (typeof timeZone !== 'string' || !SUPPORTED_TIME_ZONES.includes(timeZone)) {
    errors.timeZone = `timeZone must be one of ${SUPPORTED_TIME_ZONES.join(', ')}`;
  }
  const weekday = value.weekday;
  if (frequency === 'weekly') {
    if (!Number.isInteger(weekday) || (weekday as number) < 1 || (weekday as number) > 7) {
      errors.weekday = 'weekday must be an ISO weekday, 1 (Monday) to 7 (Sunday)';
    }
  } else if (weekday !== undefined) {
    errors.weekday = 'weekday is only for weekly schedules';
  }
  if (Object.keys(errors).length > 0) return { errors };
  const schedule: Schedule = {
    frequency: frequency as Frequency,
    time: time as string,
    timeZone: timeZone as string,
  };
  if (schedule.frequency === 'weekly') schedule.weekday = weekday as number;
  return { schedule };
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** The wall clock in `timeZone` at `instant`. */
function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Minutes east of UTC that `timeZone` observes at `instant`. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const local = localParts(instant, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The instant at which `timeZone` shows the given local date and time.
    Guess with the offset at that wall time read as UTC, then re-read the
    offset at the guess: one correction covers a transition between the two. */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = offsetMinutes(new Date(wall), timeZone);
  let candidate = wall - first * 60_000;
  const second = offsetMinutes(new Date(candidate), timeZone);
  if (second !== first) candidate = wall - second * 60_000;
  return new Date(candidate);
}

/** ISO weekday (1 Monday … 7 Sunday) of a calendar date. */
function isoWeekday(year: number, month: number, day: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function matchesDay(schedule: Schedule, weekday: number): boolean {
  switch (schedule.frequency) {
    case 'daily': return true;
    case 'weekdays': return weekday >= 1 && weekday <= 5;
    case 'weekly': return weekday === schedule.weekday;
  }
}

/** The first trigger strictly after `after`. */
export function nextRunAfter(schedule: Schedule, after: Date): Date {
  const match = TIME.exec(schedule.time);
  if (!match) throw new Error('schedule time is invalid');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const start = localParts(after, schedule.timeZone);
  // Walk forward day by day from the local date of `after`; the longest gap
  // (weekly, slot just passed) is seven days, so nine is a safe bound.
  for (let offset = 0; offset < 9; offset += 1) {
    const dayStart = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const year = dayStart.getUTCFullYear();
    const month = dayStart.getUTCMonth() + 1;
    const day = dayStart.getUTCDate();
    if (!matchesDay(schedule, isoWeekday(year, month, day))) continue;
    const candidate = zonedToUtc(year, month, day, hour, minute, schedule.timeZone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error('no trigger found within nine days');
}
