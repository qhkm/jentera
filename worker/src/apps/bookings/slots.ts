import { addDays, clockMinutes, myDate, myInstant, weekday } from './time';

export interface SlotService { durationMinutes: number; capacity: number }
export interface SlotHours { weekday: number; opens: string; closes: string }
export interface SlotSettings { minNoticeMinutes: number; horizonDays: number }
export interface Reservation { startsAt: Date; endsAt: Date; partySize: number }
export interface BlockedInterval { startsAt: Date; endsAt: Date }
export interface OpenSlot { startsAt: Date; endsAt: Date; remaining: number }

const FOREVER = new Date(8.64e15);

/** The most places held at any instant of [start, end).

    Ends are exclusive, so a booking ending at 11:00 and one starting at
    11:00 never overlap. Summing every overlapping row would be wrong: two
    successive bookings can each overlap a longer slot without ever
    overlapping each other, so this sweeps the boundaries instead. */
export function peakReserved(reservations: Reservation[], start: Date, end: Date = FOREVER): number {
  const s = start.getTime();
  const e = end.getTime();
  const edges: Array<[number, number]> = [];
  for (const held of reservations) {
    const hs = held.startsAt.getTime();
    const he = held.endsAt.getTime();
    if (hs < e && he > s) edges.push([Math.max(hs, s), held.partySize], [Math.min(he, e), -held.partySize]);
  }
  // At one instant, releases come before new holds: that is the exclusive end.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of edges) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

export function placesLeft(capacity: number, reservations: Reservation[], start: Date, end: Date): number {
  return Math.max(0, capacity - peakReserved(reservations, start, end));
}

/** The last Malaysian date a customer may book; today counts as day 0. */
export function lastBookableDate(now: Date, horizonDays: number): string {
  return addDays(myDate(now), horizonDays);
}

/** Open start times for one service, in order, each once.

    `reservations` must be the service's pending and confirmed bookings that
    can overlap the dates asked for; declined and cancelled rows hold
    nothing. Slots start at opening time and step by the duration while
    the slot still ends by closing time. */
export function openSlots(input: {
  service: SlotService;
  hours: SlotHours[];
  settings: SlotSettings;
  reservations: Reservation[];
  blocked?: BlockedInterval[];
  now: Date;
  from: string;
  days: number;
}): OpenSlot[] {
  const { service, hours, settings, reservations, now } = input;
  const blocked = input.blocked ?? [];
  const earliest = now.getTime() + settings.minNoticeMinutes * 60_000;
  const last = lastBookableDate(now, settings.horizonDays);
  const found = new Map<number, OpenSlot>();
  for (let offset = 0; offset < input.days; offset += 1) {
    const date = addDays(input.from, offset);
    if (date > last) break;
    const day = weekday(date);
    for (const range of hours) {
      if (range.weekday !== day) continue;
      const closes = clockMinutes(range.closes);
      for (let minute = clockMinutes(range.opens); minute + service.durationMinutes <= closes; minute += service.durationMinutes) {
        const startsAt = myInstant(date, minute);
        const key = startsAt.getTime();
        if (key < earliest || found.has(key)) continue;
        const endsAt = new Date(key + service.durationMinutes * 60_000);
        if (blocked.some((range) => range.startsAt.getTime() < endsAt.getTime() && range.endsAt.getTime() > key)) continue;
        const remaining = placesLeft(service.capacity, reservations, startsAt, endsAt);
        if (remaining > 0) found.set(key, { startsAt, endsAt, remaining });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
