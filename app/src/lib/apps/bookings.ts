import { BUSINESS_TIME_ZONE, malaysiaDay } from '@/lib/daily-brief';
import { AppsError } from './api';
import type { AppsApi, Booking, BookingsConfig, BookingsConfigInput, BookingsQuery, CalendarReason } from './types';

/* What the Bookings screens need that is not a network call: loading every
   page of a window, the Needs you scan, and the words for each state. */

/** The Worker serves at most 31 Malaysian days per request. */
export const WINDOW_DAYS = 31;
/** Today plus the longest horizon (90 days), counting today as day 0. */
export const PENDING_SCAN_DAYS = 91;
/** A runaway cursor stops here rather than looping forever. */
const MAX_PAGES = 20;

export type Tone = 'neutral' | 'green' | 'red' | 'amber';

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Every booking in one window, following cursors to the end. */
export async function loadWindow(api: AppsApi, query: Omit<BookingsQuery, 'cursor'>): Promise<Booking[]> {
  const rows: Booking[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await api.bookings(cursor ? { ...query, cursor } : query);
    rows.push(...result.bookings);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return rows;
}

/** Requests waiting on the owner that can still be confirmed, soonest first. */
export async function loadPendingBookings(api: AppsApi, now: Date): Promise<Booking[]> {
  const today = malaysiaDay(now);
  const windows: Omit<BookingsQuery, 'cursor'>[] = [];
  for (let offset = 0; offset < PENDING_SCAN_DAYS; offset += WINDOW_DAYS) {
    windows.push({ from: addDays(today, offset), days: Math.min(WINDOW_DAYS, PENDING_SCAN_DAYS - offset), status: 'pending' });
  }
  const pages = await Promise.all(windows.map((query) => loadWindow(api, query)));
  const seen = new Set<string>();
  return pages.flat()
    .filter((booking) => booking.status === 'pending' && !booking.expired && !seen.has(booking.id) && Boolean(seen.add(booking.id)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** What the owner should know about the booking's Google Calendar event.
    "Removed" only once removal is confirmed; a cancel still cleaning up
    says so. */
export function calendarTag(booking: Booking): { key: string; tone: Tone } | null {
  switch (booking.calendar.status) {
    case 'none': return null;
    case 'pending':
      return booking.status === 'cancelled'
        ? { key: 'bookings.calendar.removing', tone: 'neutral' }
        : { key: 'bookings.calendar.syncing', tone: 'neutral' };
    case 'created': return { key: 'bookings.calendar.added', tone: 'green' };
    case 'removed': return { key: 'bookings.calendar.removed', tone: 'neutral' };
    case 'not_connected': return { key: 'bookings.calendar.notConnected', tone: 'amber' };
    case 'failed': return { key: 'bookings.calendar.attention', tone: 'red' };
  }
}

export function calendarReasonKey(reason: CalendarReason | null): string {
  return `bookings.calendar.reason.${reason ?? 'provider'}`;
}

export function statusTag(booking: Booking): { key: string; tone: Tone } {
  if (booking.status === 'pending') {
    return booking.expired ? { key: 'bookings.status.expired', tone: 'neutral' } : { key: 'bookings.status.needsYou', tone: 'amber' };
  }
  if (booking.status === 'confirmed') return { key: 'bookings.status.confirmed', tone: 'green' };
  return { key: `bookings.status.${booking.status}`, tone: 'neutral' };
}

/** The label for the prepared message, or null when there is none. */
export function whatsappKey(booking: Booking): string | null {
  if (!booking.whatsappUrl) return null;
  if (booking.status === 'confirmed') return 'bookings.whatsapp.confirm';
  if (booking.status === 'declined') return 'bookings.whatsapp.decline';
  if (booking.status === 'cancelled') return 'bookings.whatsapp.cancel';
  return null;
}

export function actionErrorKey(error: unknown): string {
  if (error instanceof AppsError) {
    switch (error.code) {
      case 'ALREADY_DECIDED': return 'bookings.error.alreadyDecided';
      case 'EXPIRED': return 'bookings.error.expired';
      case 'NOT_RETRYABLE': return 'bookings.error.notRetryable';
      case 'CALENDAR_DISCONNECTED': return 'bookings.error.calendarDisconnected';
      case 'NOT_FOUND': return 'bookings.error.notFound';
    }
    if (error.uncertain) return 'bookings.error.uncertain';
  }
  return 'bookings.error.generic';
}

export function bookingWhen(iso: string, lang: 'en' | 'bm'): string {
  return new Intl.DateTimeFormat(lang === 'bm' ? 'ms-MY' : 'en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(iso));
}

export function groupByDay(bookings: Booking[]): [string, Booking[]][] {
  const days = new Map<string, Booking[]>();
  for (const booking of [...bookings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = malaysiaDay(new Date(booking.startsAt));
    days.set(day, [...(days.get(day) ?? []), booking]);
  }
  return [...days.entries()];
}

/** The saved settings as a save request for the same version. */
export function configToInput(config: BookingsConfig): BookingsConfigInput {
  return {
    version: config.version,
    slug: config.installation?.slug ?? '',
    accepting: config.settings?.accepting ?? true,
    minNoticeMinutes: config.settings?.minNoticeMinutes ?? 120,
    horizonDays: config.settings?.horizonDays ?? 30,
    acknowledgeAvailabilityLimits: config.settings !== null,
    services: config.services.map((service) => ({ ...service, hours: service.hours.map((range) => ({ ...range })) })),
  };
}
