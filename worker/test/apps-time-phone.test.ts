import { describe, expect, it } from 'vitest';
import { normalizeMyPhone } from '../src/apps/bookings/phone';
import { addDays, clockMinutes, isClock, isDate, myDate, myInstant, myIso, myParts, weekday } from '../src/apps/bookings/time';

describe('Malaysian time', () => {
  it('reads the Malaysian date across UTC midnight', () => {
    expect(myDate(new Date('2026-09-26T16:30:00Z'))).toBe('2026-09-27');
    expect(myDate(new Date('2026-09-26T15:59:00Z'))).toBe('2026-09-26');
  });
  it('builds instants from a Malaysian date and minutes', () => {
    expect(myInstant('2026-09-27').toISOString()).toBe('2026-09-26T16:00:00.000Z');
    expect(myInstant('2026-09-27', 15 * 60).toISOString()).toBe('2026-09-27T07:00:00.000Z');
    expect(myIso(new Date('2026-09-27T07:00:00Z'))).toBe('2026-09-27T15:00:00+08:00');
  });
  it('walks dates and weekdays', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(weekday('2026-09-27')).toBe(0); // a Sunday
    expect(myParts(new Date('2026-09-27T07:05:00Z'))).toEqual({ weekday: 0, day: 27, month: 8, hour: 15, minute: 5 });
  });
  it('validates dates and clock times strictly', () => {
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('2028-02-29')).toBe(true);
    expect(isClock('09:30')).toBe(true);
    expect(isClock('24:00')).toBe(false);
    expect(isClock('9:30')).toBe(false);
    expect(clockMinutes('15:45')).toBe(945);
    expect(clockMinutes('15:45:00')).toBe(945);
  });
});

describe('normalizeMyPhone', () => {
  it.each([
    ['012-345 6789', '60123456789'],
    ['+60 12 345 6789', '60123456789'],
    ['60123456789', '60123456789'],
    ['011-2345 6789', '601123456789'],
    ['(03) 2345-6789', '60323456789'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeMyPhone(input)).toBe(expected);
  });
  it.each(['', '12345', '+65 9123 4567', '0123-abc-456', '0060123456789', '012345'])('refuses %s', (input) => {
    expect(normalizeMyPhone(input)).toBeNull();
  });
});
