import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppsError } from '../api';
import { appsListQuery, bookingQuery, cancelBookingReads, rereadBooking, useBookingAction, writeBooking } from '../queries';
import { BOOKING_ID, bookingFixture, configFixture, fakeAppsApi } from './fixtures';
import { createQueryClient } from '@/lib/query/client';
import { keys } from '@/lib/query/keys';
import { QueryScope } from '@/lib/query/scope';
import { createTestQueryClient, TEST_BUSINESS_ID as BIZ } from '@/test-support/query';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { AppsList, Booking, BookingActionResult } from '../types';

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

  it("keeps each patched list's own dataUpdatedAt, so it does not out-age a later own read of another kept row in it", () => {
    vi.useFakeTimers();
    try {
      const client = createTestQueryClient();
      const booking = bookingFixture();
      const other = bookingFixture({ id: OTHER_ID, customerName: 'Aina' });
      client.setQueryData(TODAY, [booking, other]);
      client.setQueryData(keys.pendingBookings(BIZ), [booking, other]);
      const todayBefore = client.getQueryState(TODAY)!.dataUpdatedAt;
      const pendingBefore = client.getQueryState(keys.pendingBookings(BIZ))!.dataUpdatedAt;

      vi.advanceTimersByTime(1000);
      writeBooking(client, BIZ, bookingFixture({ status: 'confirmed' }));

      expect(client.getQueryData(TODAY)).toEqual([bookingFixture({ status: 'confirmed' }), other]);
      expect(client.getQueryState(TODAY)!.dataUpdatedAt).toBe(todayBefore);
      expect(client.getQueryState(keys.pendingBookings(BIZ))!.dataUpdatedAt).toBe(pendingBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-marks a patched list invalidated if it was invalidated before the write, so it still refetches when next shown', async () => {
    const client = createTestQueryClient();
    const booking = bookingFixture();
    const other = bookingFixture({ id: OTHER_ID, customerName: 'Aina' });
    client.setQueryData(TODAY, [booking, other]);
    client.setQueryData(keys.pendingBookings(BIZ), [booking, other]);
    // Inactive here (no observer mounted): invalidating only flags them.
    await client.invalidateQueries({ queryKey: TODAY, exact: true, refetchType: 'none' });
    await client.invalidateQueries({ queryKey: keys.pendingBookings(BIZ), exact: true, refetchType: 'none' });
    expect(client.getQueryState(TODAY)!.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.pendingBookings(BIZ))!.isInvalidated).toBe(true);

    writeBooking(client, BIZ, bookingFixture({ status: 'confirmed' }));

    expect(client.getQueryState(TODAY)!.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.pendingBookings(BIZ))!.isInvalidated).toBe(true);
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

  it("cancels a read of the booking's own query already in flight, so a stale poll cannot win a re-read", async () => {
    const client = createTestQueryClient();
    const stale = bookingFixture({ status: 'pending' });
    const fresh = bookingFixture({ status: 'declined' });
    let resolveStale!: (booking: Booking) => void;
    const api = fakeAppsApi({
      booking: vi.fn()
        .mockImplementationOnce(() => new Promise<Booking>((resolve) => { resolveStale = resolve; }))
        .mockResolvedValueOnce(fresh),
    });
    // A read of the booking's own query already in flight (a Calendar poll,
    // or a focus refetch) when the action's re-read is asked for.
    const inFlight = client.fetchQuery({ ...bookingQuery(api, BIZ, BOOKING_ID), staleTime: 0 }).catch(() => 'cancelled');
    const result = rereadBooking(client, api, BIZ, BOOKING_ID);
    resolveStale(stale);
    expect(await inFlight).toBe('cancelled');
    await expect(result).resolves.toEqual(fresh);
    expect(client.getQueryData(keys.booking(BIZ, BOOKING_ID))).toEqual(fresh);
  });

  it('never cancels or dedupes a concurrent reread of the same booking; each gets its own answer, and the cache ends with the later write', async () => {
    const client = createTestQueryClient();
    const first = bookingFixture({ status: 'declined' });
    const second = bookingFixture({ status: 'cancelled' });
    let resolveFirst!: (booking: Booking) => void;
    let resolveSecond!: (booking: Booking) => void;
    const api = fakeAppsApi({
      booking: vi.fn()
        .mockImplementationOnce(() => new Promise<Booking>((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise<Booking>((resolve) => { resolveSecond = resolve; })),
    });

    const a = rereadBooking(client, api, BIZ, BOOKING_ID);
    const b = rereadBooking(client, api, BIZ, BOOKING_ID);
    await vi.waitFor(() => expect(api.booking).toHaveBeenCalledTimes(2));

    // b's answer lands first, then a's — neither reread cancelled or
    // dedup'd onto the other's read, and each resolves with its own answer.
    resolveSecond(second);
    await expect(b).resolves.toEqual(second);
    resolveFirst(first);
    await expect(a).resolves.toEqual(first);

    // The cache simply ends with whichever write landed last (a's).
    expect(client.getQueryData(keys.booking(BIZ, BOOKING_ID))).toEqual(first);
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
  });

  it("resolves without waiting for the apps list to be read again, even with a mounted observer watching it", async () => {
    const client = createTestQueryClient();
    const confirmed = bookingFixture({ status: 'confirmed' });
    let resolveAppsList!: (list: AppsList) => void;
    const api = fakeAppsApi({
      decide: vi.fn(async () => ({ booking: confirmed, whatsappUrl: null, calendarQueued: false })),
      list: vi.fn(() => new Promise<AppsList>((resolve) => { resolveAppsList = resolve; })),
    });
    function useBoth() {
      return { action: useBookingAction(api), appsList: useQuery(appsListQuery(api, BIZ)) };
    }
    const { result } = renderHook(useBoth, { wrapper: scope(client) });
    // A mounted observer's own read of the apps list, already in flight.
    await vi.waitFor(() => expect(result.current.appsList.fetchStatus).toBe('fetching'));

    await act(async () => { await result.current.action.mutateAsync({ id: BOOKING_ID, action: 'confirm' }); });

    // The action resolved even though onSettled asked for the apps list
    // again and that mounted observer's read is still in flight.
    expect(result.current.appsList.fetchStatus).toBe('fetching');
    resolveAppsList({ apps: [], available: ['bookings'] });
    await vi.waitFor(() => expect(result.current.appsList.fetchStatus).toBe('idle'));
  });

  it("cancels its own reads again when the answer lands, so one already out while the request was in flight can't overwrite it", async () => {
    const client = createTestQueryClient();
    const pending = bookingFixture();
    client.setQueryData(TODAY, [pending]);
    client.setQueryData(keys.pendingBookings(BIZ), [pending]);
    client.setQueryData(keys.booking(BIZ, BOOKING_ID), pending);
    const confirmed = bookingFixture({ status: 'confirmed' });
    let resolveDecide!: (result: BookingActionResult) => void;
    const api = fakeAppsApi({
      decide: vi.fn(() => new Promise<BookingActionResult>((resolve) => { resolveDecide = resolve; })),
    });
    const { result } = renderHook(() => useBookingAction(api), { wrapper: scope(client) });

    let mutationPromise!: Promise<BookingActionResult>;
    await act(async () => {
      mutationPromise = result.current.mutateAsync({ id: BOOKING_ID, action: 'confirm' });
      await vi.waitFor(() => expect(api.decide).toHaveBeenCalledTimes(1));
    });

    // Reads of all three keys start while the request is out (after onMutate's
    // cancel, before the answer lands), each held so it can be resolved late.
    const held: Array<() => void> = [];
    const readList = (queryKey: readonly unknown[]) => client.fetchQuery({
      queryKey, queryFn: () => new Promise<Booking[]>((resolve) => held.push(() => resolve([pending]))), staleTime: 0,
    }).catch(() => 'cancelled');
    const readOwn = (queryKey: readonly unknown[]) => client.fetchQuery({
      queryKey, queryFn: () => new Promise<Booking>((resolve) => held.push(() => resolve(pending))), staleTime: 0,
    }).catch(() => 'cancelled');
    const reads = [readList(TODAY), readList(keys.pendingBookings(BIZ)), readOwn(keys.booking(BIZ, BOOKING_ID))];
    expect(held).toHaveLength(3);

    await act(async () => {
      resolveDecide({ booking: confirmed, whatsappUrl: null, calendarQueued: false });
      await mutationPromise;
    });
    held.forEach((resolve) => resolve());
    await Promise.all(reads);

    expect(client.getQueryData(TODAY)).toEqual([confirmed]);
    expect(client.getQueryData(keys.pendingBookings(BIZ))).toEqual([]);
    expect(client.getQueryData(keys.booking(BIZ, BOOKING_ID))).toEqual(confirmed);
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
