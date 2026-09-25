import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppsError } from '../api';
import { cancelBookingReads, rereadBooking, useBookingAction, writeBooking } from '../queries';
import { BOOKING_ID, bookingFixture, configFixture, fakeAppsApi } from './fixtures';
import { createQueryClient } from '@/lib/query/client';
import { keys } from '@/lib/query/keys';
import { QueryScope } from '@/lib/query/scope';
import { createTestQueryClient, TEST_BUSINESS_ID as BIZ } from '@/test-support/query';
import type { QueryClient } from '@tanstack/react-query';
import type { Booking } from '../types';

const OTHER_ID = '11111111-1111-4111-8111-00000000000e';
const TODAY = keys.bookingWindow(BIZ, '2026-10-05', 1);
const UPCOMING = keys.bookingWindow(BIZ, '2026-10-05', 31);
const LATER = keys.bookingWindow(BIZ, '2026-11-05', 31);

function scope(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryScope client={client} businessId={BIZ}>{children}</QueryScope>;
}

describe('writing a booking into the cache', () => {
  it('puts the answer in its own query and in every list that holds it, and leaves everything else alone', () => {
    const client = createTestQueryClient();
    const booking = bookingFixture();
    const other = bookingFixture({ id: OTHER_ID, customerName: 'Aina' });
    client.setQueryData(TODAY, [booking, other]);
    client.setQueryData(UPCOMING, [booking, other]);
    client.setQueryData(LATER, [other]);
    client.setQueryData(keys.pendingBookings(BIZ), [booking, other]);
    client.setQueryData(keys.bookingsConfig(BIZ), configFixture());
    client.setQueryData(keys.pendingBookings('biz-other'), [booking]);
    const laterBefore = client.getQueryState(LATER)!.dataUpdatedAt;
    const confirmed = bookingFixture({ status: 'confirmed' });

    writeBooking(client, BIZ, confirmed);

    expect(client.getQueryData(keys.booking(BIZ, BOOKING_ID))).toEqual(confirmed);
    expect(client.getQueryData(TODAY)).toEqual([confirmed, other]);
    expect(client.getQueryData(UPCOMING)).toEqual([confirmed, other]);
    // The waiting requests keep only what still waits.
    expect(client.getQueryData(keys.pendingBookings(BIZ))).toEqual([other]);
    expect(client.getQueryData(LATER)).toEqual([other]);
    expect(client.getQueryState(LATER)!.dataUpdatedAt).toBe(laterBefore);
    expect(client.getQueryData(keys.bookingsConfig(BIZ))).toEqual(configFixture());
    expect(client.getQueryData(keys.pendingBookings('biz-other'))).toEqual([booking]);
  });

  it('cancels a list read in flight, so what it read before a decision never lands', async () => {
    const client = createTestQueryClient();
    let answer!: (rows: Booking[]) => void;
    const read = client.fetchQuery({ queryKey: TODAY, queryFn: () => new Promise<Booking[]>((resolve) => { answer = resolve; }) })
      .catch(() => 'cancelled');
    await cancelBookingReads(client, BIZ, BOOKING_ID);
    answer([bookingFixture()]);
    expect(await read).toBe('cancelled');
    expect(client.getQueryData(TODAY)).toBeUndefined();
  });

  it('re-reads a booking whose action failed and writes it everywhere', async () => {
    const client = createTestQueryClient();
    client.setQueryData(keys.pendingBookings(BIZ), [bookingFixture()]);
    const declined = bookingFixture({ status: 'declined' });
    const api = fakeAppsApi({ booking: vi.fn(async () => declined) });
    await expect(rereadBooking(client, api, BIZ, BOOKING_ID)).resolves.toEqual(declined);
    expect(client.getQueryData(keys.booking(BIZ, BOOKING_ID))).toEqual(declined);
    expect(client.getQueryData(keys.pendingBookings(BIZ))).toEqual([]);
  });
});

describe('a booking action', () => {
  it('writes the answer everywhere and marks the lists to be read again', async () => {
    const client = createTestQueryClient();
    client.setQueryData(TODAY, [bookingFixture()]);
    client.setQueryData(keys.pendingBookings(BIZ), [bookingFixture()]);
    const confirmed = bookingFixture({ status: 'confirmed' });
    const api = fakeAppsApi({ decide: vi.fn(async () => ({ booking: confirmed, whatsappUrl: null, calendarQueued: false })) });
    const { result } = renderHook(() => useBookingAction(api), { wrapper: scope(client) });
    await act(async () => { await result.current.mutateAsync({ id: BOOKING_ID, action: 'confirm' }); });
    expect(api.decide).toHaveBeenCalledWith(BOOKING_ID, 'confirm');
    expect(client.getQueryData(TODAY)).toEqual([confirmed]);
    expect(client.getQueryData(keys.pendingBookings(BIZ))).toEqual([]);
    expect(client.getQueryState(TODAY)!.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.appsList(BIZ))).toBeUndefined();
  });

  it('is never sent twice, whatever the failure, even with the production retry rules', async () => {
    const client = createQueryClient();
    const api = fakeAppsApi({ decide: vi.fn().mockRejectedValue(new AppsError('NETWORK', 0, true)) });
    const { result } = renderHook(() => useBookingAction(api), { wrapper: scope(client) });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: BOOKING_ID, action: 'confirm' })).rejects.toBeInstanceOf(AppsError);
    });
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it('sends cancel and Retry Calendar to their own endpoints', async () => {
    const client = createTestQueryClient();
    const api = fakeAppsApi();
    const { result } = renderHook(() => useBookingAction(api), { wrapper: scope(client) });
    await act(async () => { await result.current.mutateAsync({ id: BOOKING_ID, action: 'cancel' }); });
    await act(async () => { await result.current.mutateAsync({ id: BOOKING_ID, action: 'retry' }); });
    expect(api.cancel).toHaveBeenCalledWith(BOOKING_ID);
    expect(api.retryCalendar).toHaveBeenCalledWith(BOOKING_ID);
    expect(api.decide).not.toHaveBeenCalled();
  });
});
