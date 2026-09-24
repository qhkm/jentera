import type {
  AppsApi, AppsList, Booking, BookingActionResult, BookingsConfig, BookingsConfigInput, BookingsPage, BookingsQuery,
} from './types';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A failed apps request, keeping what the screen needs to explain it:
    the Worker's code (CONFIG_CHANGED, ALREADY_DECIDED, …, or NETWORK /
    NOT_FOUND / INVALID_RESPONSE / REQUEST_FAILED), and whether a write may
    have happened although no answer arrived. The shared `call<T>` in
    remote.ts drops the code, so apps has its own, like Routines. */
export class AppsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly uncertain = false,
    public readonly serviceId: string | null = null,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppsError';
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

async function call(path: string, write?: { method: 'POST' | 'PUT'; body: unknown }): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/apps${path}`, {
      method: write?.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      ...(write ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(write.body) } : {}),
    });
  } catch {
    throw new AppsError('NETWORK', 0, write !== undefined);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !object(data) || data.ok !== true) {
    const body = object(data) ? data : {};
    throw new AppsError(
      typeof body.code === 'string' ? body.code : response.status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED',
      response.status,
      write !== undefined && response.status >= 500,
      typeof body.serviceId === 'string' ? body.serviceId : null,
      typeof body.err === 'string' ? body.err : undefined,
    );
  }
  return data;
}

function isBooking(value: unknown): value is Booking {
  return object(value) && typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.reference === 'string' && typeof value.customerName === 'string'
    && typeof value.serviceName === 'string'
    && typeof value.startsAt === 'string' && Number.isFinite(Date.parse(value.startsAt))
    && ['pending', 'confirmed', 'declined', 'cancelled'].includes(String(value.status))
    && typeof value.expired === 'boolean'
    && object(value.calendar) && typeof value.calendar.status === 'string'
    && typeof value.calendar.canRetry === 'boolean'
    && (value.whatsappUrl === null
      || (typeof value.whatsappUrl === 'string' && value.whatsappUrl.startsWith('https://wa.me/')));
}

function isConfig(value: unknown): value is BookingsConfig {
  return object(value) && Array.isArray(value.services)
    && (value.installation === null || (object(value.installation)
      && typeof value.installation.slug === 'string' && typeof value.installation.publicUrl === 'string'))
    && (value.version === null || Number.isInteger(value.version));
}

function bookingPath(id: string): string {
  if (!UUID.test(id)) throw new AppsError('NOT_FOUND', 404);
  return `/bookings/bookings/${encodeURIComponent(id)}`;
}

function action(data: Record<string, unknown>): BookingActionResult {
  if (!isBooking(data.booking) || typeof data.calendarQueued !== 'boolean') {
    throw new AppsError('INVALID_RESPONSE', 200, true);
  }
  return { booking: data.booking, whatsappUrl: data.booking.whatsappUrl, calendarQueued: data.calendarQueued };
}

export class RemoteAppsApi implements AppsApi {
  async list(): Promise<AppsList> {
    const data = await call('');
    if (!Array.isArray(data.apps) || !Array.isArray(data.available)) throw new AppsError('INVALID_RESPONSE');
    return { apps: data.apps as AppsList['apps'], available: data.available as AppsList['available'] };
  }

  async bookingsConfig(): Promise<BookingsConfig> {
    const data = await call('/bookings/config');
    if (!isConfig(data.config)) throw new AppsError('INVALID_RESPONSE');
    return data.config;
  }

  async saveBookingsConfig(input: BookingsConfigInput): Promise<BookingsConfig> {
    const data = await call('/bookings/config', { method: 'PUT', body: input });
    if (!isConfig(data.config)) throw new AppsError('INVALID_RESPONSE', 200, true);
    return data.config;
  }

  async bookings(query: BookingsQuery): Promise<BookingsPage> {
    const params = new URLSearchParams({
      from: query.from, days: String(query.days), limit: '50',
      ...(query.status ? { status: query.status } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const data = await call(`/bookings/bookings?${params}`);
    if (!Array.isArray(data.bookings) || !data.bookings.every(isBooking)
      || !(data.nextCursor === null || typeof data.nextCursor === 'string')) {
      throw new AppsError('INVALID_RESPONSE');
    }
    return { bookings: data.bookings, nextCursor: data.nextCursor as string | null };
  }

  async booking(id: string): Promise<Booking> {
    const data = await call(bookingPath(id));
    if (!isBooking(data.booking)) throw new AppsError('INVALID_RESPONSE');
    return data.booking;
  }

  async decide(id: string, decision: 'confirm' | 'decline'): Promise<BookingActionResult> {
    return action(await call(`${bookingPath(id)}/decide`, { method: 'POST', body: { decision } }));
  }

  async cancel(id: string): Promise<BookingActionResult> {
    return action(await call(`${bookingPath(id)}/cancel`, { method: 'POST', body: {} }));
  }

  async retryCalendar(id: string): Promise<BookingActionResult> {
    return action(await call(`${bookingPath(id)}/calendar/retry`, { method: 'POST', body: {} }));
  }
}
