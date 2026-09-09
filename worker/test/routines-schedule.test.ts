/**
 * Schedule math for Routines v1: strict validation and the next trigger
 * strictly after a given instant, computed in the routine's named zone.
 * 2026-09-09 is a Wednesday; 2026-09-11 a Friday; 2026-09-14 a Monday.
 */
import { describe, expect, it } from 'vitest';
import { nextRunAfter, validateSchedule } from '../src/routines/schedule';

const KL = 'Asia/Kuala_Lumpur';
const at = (iso: string) => new Date(iso);

describe('validateSchedule', () => {
  it('accepts the three frequencies with a strict HH:mm and the named zone', () => {
    expect(validateSchedule({ frequency: 'daily', time: '08:00', timeZone: KL }))
      .toEqual({ schedule: { frequency: 'daily', time: '08:00', timeZone: KL } });
    expect(validateSchedule({ frequency: 'weekly', weekday: 5, time: '17:00', timeZone: KL }))
      .toEqual({ schedule: { frequency: 'weekly', weekday: 5, time: '17:00', timeZone: KL } });
    expect(validateSchedule({ frequency: 'daily', time: '00:00', timeZone: KL }))
      .toEqual({ schedule: { frequency: 'daily', time: '00:00', timeZone: KL } });
    expect(validateSchedule({ frequency: 'daily', time: '23:59', timeZone: KL }))
      .toEqual({ schedule: { frequency: 'daily', time: '23:59', timeZone: KL } });
  });

  it.each([
    [{ frequency: 'daily', time: '8:00', timeZone: KL }, 'time'],
    [{ frequency: 'daily', time: '24:00', timeZone: KL }, 'time'],
    [{ frequency: 'daily', time: '08:60', timeZone: KL }, 'time'],
    [{ frequency: 'daily', time: '08:00', timeZone: 'UTC' }, 'timeZone'],
    [{ frequency: 'monthly', time: '08:00', timeZone: KL }, 'frequency'],
    [{ frequency: 'weekly', time: '08:00', timeZone: KL }, 'weekday'],
    [{ frequency: 'weekly', weekday: 0, time: '08:00', timeZone: KL }, 'weekday'],
    [{ frequency: 'weekly', weekday: 8, time: '08:00', timeZone: KL }, 'weekday'],
    [{ frequency: 'daily', weekday: 3, time: '08:00', timeZone: KL }, 'weekday'],
    [{ frequency: 'daily', time: '08:00', timeZone: KL, extra: true }, 'extra'],
    ['not an object', 'schedule'],
  ])('rejects %j on %s', (input, field) => {
    const result = validateSchedule(input);
    expect('errors' in result && Object.keys(result.errors)).toContain(field);
  });
});

describe('nextRunAfter', () => {
  it('picks the first matching local time strictly after the instant', () => {
    const daily = { frequency: 'daily' as const, time: '08:00', timeZone: KL };
    // 07:30 in KL on the 10th → 08:00 KL the same day, which is 00:00Z.
    expect(nextRunAfter(daily, at('2026-09-09T23:30:00Z')).toISOString()).toBe('2026-09-10T00:00:00.000Z');
    // exactly on the trigger → the next one, never the same instant
    expect(nextRunAfter(daily, at('2026-09-10T00:00:00Z')).toISOString()).toBe('2026-09-11T00:00:00.000Z');
    // one millisecond before → the same trigger
    expect(nextRunAfter(daily, at('2026-09-09T23:59:59.999Z')).toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('skips the weekend for weekdays', () => {
    const weekdays = { frequency: 'weekdays' as const, time: '08:00', timeZone: KL };
    // Friday 09:00 KL → Monday 08:00 KL
    expect(nextRunAfter(weekdays, at('2026-09-11T01:00:00Z')).toISOString()).toBe('2026-09-14T00:00:00.000Z');
    // Saturday → Monday
    expect(nextRunAfter(weekdays, at('2026-09-12T10:00:00Z')).toISOString()).toBe('2026-09-14T00:00:00.000Z');
    // Wednesday 07:00 KL → Wednesday 08:00 KL
    expect(nextRunAfter(weekdays, at('2026-09-08T23:00:00Z')).toISOString()).toBe('2026-09-09T00:00:00.000Z');
  });

  it('lands weekly on the ISO weekday, a week later when the slot has just passed', () => {
    const friday = { frequency: 'weekly' as const, weekday: 5, time: '17:00', timeZone: KL };
    expect(nextRunAfter(friday, at('2026-09-09T00:00:00Z')).toISOString()).toBe('2026-09-11T09:00:00.000Z');
    expect(nextRunAfter(friday, at('2026-09-11T09:00:00Z')).toISOString()).toBe('2026-09-18T09:00:00.000Z');
    const sunday = { frequency: 'weekly' as const, weekday: 7, time: '09:30', timeZone: KL };
    expect(nextRunAfter(sunday, at('2026-09-11T09:00:00Z')).toISOString()).toBe('2026-09-13T01:30:00.000Z');
  });

  it('crosses month and year boundaries in local time', () => {
    const early = { frequency: 'daily' as const, time: '00:30', timeZone: KL };
    // 00:30 KL on 1 Jan 2027 is 16:30Z on 31 Dec 2026
    expect(nextRunAfter(early, at('2026-12-31T16:29:00Z')).toISOString()).toBe('2026-12-31T16:30:00.000Z');
    expect(nextRunAfter(early, at('2026-12-31T16:30:00Z')).toISOString()).toBe('2027-01-01T16:30:00.000Z');
    expect(nextRunAfter(early, at('2026-09-30T16:30:00Z')).toISOString()).toBe('2026-10-01T16:30:00.000Z');
  });

  it('follows the zone rather than a fixed offset', () => {
    // New York moves to daylight time on 2026-03-08; 09:00 local is 14:00Z before and 13:00Z after.
    const ny = { frequency: 'daily' as const, time: '09:00', timeZone: 'America/New_York' };
    expect(nextRunAfter(ny, at('2026-03-07T00:00:00Z')).toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(nextRunAfter(ny, at('2026-03-07T14:00:00Z')).toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('does not depend on the process timezone', () => {
    const daily = { frequency: 'daily' as const, time: '08:00', timeZone: KL };
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(nextRunAfter(daily, at('2026-09-09T23:30:00Z')).toISOString()).toBe('2026-09-10T00:00:00.000Z');
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });
});
