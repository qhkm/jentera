import { describe, expect, it, vi } from 'vitest';
import { AppsError } from '../api';
import {
  actionErrorKey, addDays, bookingWhen, calendarReasonKey, calendarTag, configToInput, groupByDay,
  loadPendingBookings, loadWindow, statusTag, whatsappKey,
} from '../bookings';
import { bookingFixture, configFixture, fakeAppsApi } from './fixtures';
import type { BookingsQuery } from '../types';

describe('loading bookings', () => {
  it('follows cursors to the end of a window', async () => {
    const api = fakeAppsApi({
      bookings: vi.fn()
        .mockResolvedValueOnce({ bookings: [bookingFixture({ id: '11111111-1111-4111-8111-000000000001' })], nextCursor: 'c1' })
        .mockResolvedValueOnce({ bookings: [bookingFixture({ id: '11111111-1111-4111-8111-000000000002' })], nextCursor: null }),
    });
    const rows = await loadWindow(api, { from: '2026-10-06', days: 1 });
    expect(rows.map((b) => b.id.slice(-1))).toEqual(['1', '2']);
    expect(api.bookings).toHaveBeenLastCalledWith({ from: '2026-10-06', days: 1, cursor: 'c1' });
  });

  it('scans 91 Malaysian days for pending requests the owner can still decide, soonest first', async () => {
    const later = bookingFixture({ id: '11111111-1111-4111-8111-00000000000a', startsAt: '2026-12-01T02:00:00.000Z' });
    const sooner = bookingFixture({ id: '11111111-1111-4111-8111-00000000000b', startsAt: '2026-10-07T02:00:00.000Z' });
    const expired = bookingFixture({ id: '11111111-1111-4111-8111-00000000000c', expired: true });
    const api = fakeAppsApi({
      bookings: vi.fn(async (_query: BookingsQuery) => ({ bookings: [later, sooner, expired], nextCursor: null })),
    });
    // 20:00 UTC on 4 Oct is 04:00 on 5 Oct in Malaysia.
    const rows = await loadPendingBookings(api, new Date('2026-10-04T20:00:00Z'));
    expect(api.bookings.mock.calls.map(([q]) => [q.from, q.days, q.status])).toEqual([['2026-10-05', 91, 'pending']]);
    expect(rows.map((b) => b.id.slice(-1))).toEqual(['b', 'a']);
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('labels', () => {
  it('tags Calendar state honestly, including cleanup still running after a cancel', () => {
    const tag = (over: Parameters<typeof bookingFixture>[0]) => calendarTag(bookingFixture(over));
    const cal = (status: string) => ({ status, error: null, reason: null, canRetry: false, account: null }) as never;
    expect(tag({ status: 'pending' })).toBeNull();
    expect(tag({ status: 'confirmed', calendar: cal('pending') })).toEqual({ key: 'bookings.calendar.syncing', tone: 'neutral' });
    expect(tag({ status: 'cancelled', calendar: cal('pending') })).toEqual({ key: 'bookings.calendar.removing', tone: 'neutral' });
    expect(tag({ status: 'confirmed', calendar: cal('created') })).toEqual({ key: 'bookings.calendar.added', tone: 'green' });
    expect(tag({ status: 'cancelled', calendar: cal('removed') })).toEqual({ key: 'bookings.calendar.removed', tone: 'neutral' });
    expect(tag({ status: 'confirmed', calendar: cal('not_connected') })).toEqual({ key: 'bookings.calendar.notConnected', tone: 'amber' });
    expect(tag({ status: 'confirmed', calendar: cal('failed') })).toEqual({ key: 'bookings.calendar.attention', tone: 'red' });
    expect(calendarReasonKey('removed_in_google')).toBe('bookings.calendar.reason.removed_in_google');
    expect(calendarReasonKey(null)).toBe('bookings.calendar.reason.provider');
    // Disconnected with no Google account on record: nothing to reconnect, so no retry to promise.
    expect(calendarReasonKey('disconnected', true)).toBe('bookings.calendar.reason.disconnected');
    expect(calendarReasonKey('disconnected', false)).toBe('bookings.calendar.reason.disconnectedNoAccount');
  });

  it('names status and the WhatsApp action by what was decided', () => {
    expect(statusTag(bookingFixture())).toEqual({ key: 'bookings.status.needsYou', tone: 'amber' });
    expect(statusTag(bookingFixture({ expired: true }))).toEqual({ key: 'bookings.status.expired', tone: 'neutral' });
    expect(statusTag(bookingFixture({ status: 'confirmed' }))).toEqual({ key: 'bookings.status.confirmed', tone: 'green' });
    expect(whatsappKey(bookingFixture({ status: 'confirmed', whatsappUrl: 'https://wa.me/6012?text=x' }))).toBe('bookings.whatsapp.confirm');
    expect(whatsappKey(bookingFixture({ status: 'declined', whatsappUrl: 'https://wa.me/6012?text=x' }))).toBe('bookings.whatsapp.decline');
    expect(whatsappKey(bookingFixture({ status: 'cancelled', whatsappUrl: 'https://wa.me/6012?text=x' }))).toBe('bookings.whatsapp.cancel');
    expect(whatsappKey(bookingFixture({ status: 'confirmed', whatsappUrl: null }))).toBeNull();
  });

  it('explains a refused action by its code', () => {
    expect(actionErrorKey(new AppsError('ALREADY_DECIDED', 409))).toBe('bookings.error.alreadyDecided');
    expect(actionErrorKey(new AppsError('EXPIRED', 409))).toBe('bookings.error.expired');
    expect(actionErrorKey(new AppsError('CALENDAR_DISCONNECTED', 409))).toBe('bookings.error.calendarDisconnected');
    expect(actionErrorKey(new AppsError('NETWORK', 0, true))).toBe('bookings.error.uncertain');
    expect(actionErrorKey(new Error('boom'))).toBe('bookings.error.generic');
  });

  it('formats a time in Malaysia and groups by Malaysian day', () => {
    expect(bookingWhen('2026-10-06T02:00:00.000Z', 'en')).toMatch(/Tue.*6.*Oct.*10:00/);
    const late = bookingFixture({ id: '11111111-1111-4111-8111-00000000000d', startsAt: '2026-10-06T17:00:00.000Z' });
    expect(groupByDay([late, bookingFixture()]).map(([day, rows]) => [day, rows.length])).toEqual([['2026-10-06', 1], ['2026-10-07', 1]]);
  });

  it('turns a saved config back into a save request for the same version', () => {
    expect(configToInput(configFixture())).toEqual({
      version: 3, slug: 'seido', accepting: true, minNoticeMinutes: 120, changeCutoffMinutes: 360, horizonDays: 30,
      location: '12 Jalan Example, Kuala Lumpur',
      acknowledgeAvailabilityLimits: true,
      services: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Cupping class', description: 'A guided recovery session.', durationMinutes: 60, capacity: 4,
        priceLabel: 'RM45', active: true, hours: [{ weekday: 2, opens: '10:00', closes: '13:00' }] }],
    });
  });
});
