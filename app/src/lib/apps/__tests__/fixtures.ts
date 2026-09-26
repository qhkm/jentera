import { vi, type Mock } from 'vitest';
import type { AppsApi, Booking, BookingsConfig } from '../types';

export const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
export const SERVICE_ID = '22222222-2222-4222-8222-222222222222';

export function bookingFixture(over: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_ID, reference: 'K7Q2MP', serviceId: SERVICE_ID, serviceName: 'Cupping class',
    startsAt: '2026-10-06T02:00:00.000Z', endsAt: '2026-10-06T03:00:00.000Z', partySize: 2,
    customerName: 'Aisyah', customerPhone: '60123456789', note: null, status: 'pending', expired: false,
    decidedAt: null, cancelledAt: null,
    calendar: { status: 'none', error: null, reason: null, canRetry: false, account: null },
    whatsappUrl: null, reminderWhatsappUrl: null, createdAt: '2026-10-04T00:00:00.000Z',
    ...over,
  };
}

export function configFixture(over: Partial<BookingsConfig> = {}): BookingsConfig {
  return {
    installation: { slug: 'seido', state: 'active', publicUrl: 'https://sites.test/b/seido' },
    version: 3,
    settings: { accepting: true, minNoticeMinutes: 120, changeCutoffMinutes: 360, horizonDays: 30, location: '12 Jalan Example, Kuala Lumpur', availabilityAcknowledgedAt: '2026-10-01T00:00:00.000Z' },
    services: [{
      id: SERVICE_ID, name: 'Cupping class', description: 'A guided recovery session.', durationMinutes: 60, capacity: 4, priceLabel: 'RM45', active: true,
      hours: [{ weekday: 2, opens: '10:00', closes: '13:00' }],
    }],
    blocks: [],
    calendarProtection: { connected: true, account: 'owner@example.com', syncedAt: '2026-10-05T00:00:00.000Z', lastError: null },
    ...over,
  };
}

/** Each method as a Mock typed on AppsApi's own signature — fixed, not
    inferred from whatever a test passes as an override — so `.mock.calls`
    always resolves to the interface's real parameter/return types (e.g.
    `BookingsQuery`), whether or not a test replaces that method. */
type FakeAppsApi = { [K in keyof AppsApi]: Mock<AppsApi[K]> };

/** Every method a vi.fn with a harmless default; override what a test needs. */
export function fakeAppsApi(over: Partial<FakeAppsApi> = {}): FakeAppsApi {
  return {
    list: vi.fn(async () => ({ apps: [], available: ['bookings' as const] })),
    bookingsConfig: vi.fn(async () => configFixture()),
    saveBookingsConfig: vi.fn(async () => configFixture()),
    bookings: vi.fn(async () => ({ bookings: [], nextCursor: null })),
    booking: vi.fn(async () => bookingFixture()),
    decide: vi.fn(async () => ({ booking: bookingFixture({ status: 'confirmed' }), whatsappUrl: null, calendarQueued: false })),
    cancel: vi.fn(async () => ({ booking: bookingFixture({ status: 'cancelled' }), whatsappUrl: null, calendarQueued: false })),
    retryCalendar: vi.fn(async () => ({ booking: bookingFixture({ status: 'confirmed' }), whatsappUrl: null, calendarQueued: true })),
    ...over,
  };
}
