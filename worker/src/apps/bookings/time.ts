/* Malaysian wall-clock time for Bookings.

   Malaysia has kept UTC+8 with no daylight saving since 1982, so a fixed
   offset is exact, and it keeps this arithmetic independent of Intl data,
   which varies by runtime. Every date a person sees or types is a Malaysian
   date; every instant stored is a timestamptz. */

export const MY_TIME_ZONE = 'Asia/Kuala_Lumpur';
const OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** 'HH:MM' from 00:00 to 23:59. Midnight as a closing time is not supported. */
export function isClock(value: string): boolean {
  return CLOCK.test(value);
}

/** Minutes after midnight for 'HH:MM' or Postgres 'HH:MM:SS'. */
export function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** The Malaysian calendar date of an instant, as YYYY-MM-DD. */
export function myDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Malaysian date begins, plus `minutes`. */
export function myInstant(date: string, minutes = 0): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MS + minutes * 60_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday, matching booking_hours.weekday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** RFC 3339 with the Malaysian offset: 2026-09-27T15:00:00+08:00. */
export function myIso(instant: Date): string {
  return `${new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 19)}+08:00`;
}

export function myParts(instant: Date): { weekday: number; day: number; month: number; hour: number; minute: number } {
  const local = new Date(instant.getTime() + OFFSET_MS);
  return {
    weekday: local.getUTCDay(),
    day: local.getUTCDate(),
    month: local.getUTCMonth(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}
