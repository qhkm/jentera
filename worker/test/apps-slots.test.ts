import { describe, expect, it } from 'vitest';
import { lastBookableDate, openSlots, peakReserved, placesLeft, type Reservation } from '../src/apps/bookings/slots';

const at = (iso: string) => new Date(iso);
const r = (start: string, end: string, partySize: number): Reservation =>
  ({ startsAt: at(start), endsAt: at(end), partySize });

describe('peakReserved and placesLeft', () => {
  it('treats ends as exclusive, so back-to-back bookings do not overlap', () => {
    const held = [r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 1)];
    expect(placesLeft(1, held, at('2026-09-27T03:00:00Z'), at('2026-09-27T04:00:00Z'))).toBe(1);
  });
  it('counts partial overlap: a 10–11 booking blocks a 10:30–11:30 slot at capacity 1', () => {
    const held = [r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 1)];
    expect(placesLeft(1, held, at('2026-09-27T02:30:00Z'), at('2026-09-27T03:30:00Z'))).toBe(0);
  });
  it('does not double-count two successive bookings under one longer slot', () => {
    const held = [
      r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 2),
      r('2026-09-27T03:00:00Z', '2026-09-27T04:00:00Z', 2),
    ];
    expect(peakReserved(held, at('2026-09-27T02:00:00Z'), at('2026-09-27T04:00:00Z'))).toBe(2);
    expect(placesLeft(3, held, at('2026-09-27T02:00:00Z'), at('2026-09-27T04:00:00Z'))).toBe(1);
  });
  it('adds up truly concurrent bookings, including one that started earlier', () => {
    const held = [
      r('2026-09-27T01:00:00Z', '2026-09-27T03:00:00Z', 1),
      r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 2),
    ];
    expect(peakReserved(held, at('2026-09-27T02:00:00Z'), at('2026-09-27T03:00:00Z'))).toBe(3);
  });
  it('looks forever when no end is given', () => {
    const held = [r('2030-01-01T00:00:00Z', '2030-01-01T01:00:00Z', 4)];
    expect(peakReserved(held, at('2026-09-27T00:00:00Z'))).toBe(4);
  });
});

describe('openSlots', () => {
  const service = { durationMinutes: 60, capacity: 2 };
  const settings = { minNoticeMinutes: 120, horizonDays: 30 };
  // Sunday 27 Sep 2026, 10:00–13:00 Malaysian time.
  const hours = [{ weekday: 0, opens: '10:00', closes: '13:00' }];
  const now = at('2026-09-26T00:00:00Z'); // Sat 08:00 in Malaysia

  it('steps by duration from opening and stops when a slot would pass closing', () => {
    const slots = openSlots({ service, hours, settings, reservations: [], now, from: '2026-09-27', days: 1 });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-09-27T02:00:00.000Z', '2026-09-27T03:00:00.000Z', '2026-09-27T04:00:00.000Z',
    ]);
    expect(slots.every((s) => s.remaining === 2)).toBe(true);
  });
  it('drops starts inside the minimum notice', () => {
    const late = at('2026-09-27T01:30:00Z'); // 09:30 Malaysia; notice ends 11:30
    const slots = openSlots({ service, hours, settings, reservations: [], now: late, from: '2026-09-27', days: 1 });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(['2026-09-27T04:00:00.000Z']);
  });
  it('hides full slots and shows what is left of partly held ones', () => {
    const reservations = [r('2026-09-27T02:00:00Z', '2026-09-27T03:00:00Z', 2), r('2026-09-27T03:00:00Z', '2026-09-27T04:00:00Z', 1)];
    const slots = openSlots({ service, hours, settings, reservations, now, from: '2026-09-27', days: 1 });
    expect(slots.map((s) => [s.startsAt.toISOString(), s.remaining])).toEqual([
      ['2026-09-27T03:00:00.000Z', 1], ['2026-09-27T04:00:00.000Z', 2],
    ]);
  });
  it('hides slots that overlap a closure, while keeping adjacent slots', () => {
    const blocked = [{
      startsAt: at('2026-09-27T03:00:00Z'),
      endsAt: at('2026-09-27T04:00:00Z'),
    }];
    const slots = openSlots({ service, hours, settings, reservations: [], blocked, now, from: '2026-09-27', days: 1 });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-09-27T02:00:00.000Z',
      '2026-09-27T04:00:00.000Z',
    ]);
  });
  it('never offers a date past the horizon, whatever the caller asks for', () => {
    expect(lastBookableDate(now, 1)).toBe('2026-09-27');
    const beyond = openSlots({ service, hours, settings: { ...settings, horizonDays: 1 }, reservations: [], now, from: '2026-10-04', days: 7 });
    expect(beyond).toEqual([]);
  });
  it('returns each start once even if ranges repeat', () => {
    const doubled = [...hours, { weekday: 0, opens: '10:00', closes: '11:00' }];
    const slots = openSlots({ service, hours: doubled, settings, reservations: [], now, from: '2026-09-27', days: 1 });
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(slots.length);
  });
});
