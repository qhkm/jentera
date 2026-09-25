import { notifyManager, queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { bookingListsFilter, keys, mutationKeys } from '@/lib/query/keys';
import { useRequiredBusinessId } from '@/lib/query/scope';
import { loadPendingBookings, loadWindow, stillWaiting } from './bookings';
import type {
  AppsApi, AppsList, Booking, BookingAction, BookingActionResult, BookingsConfigInput,
} from './types';

/* The Apps API as cached queries. Every screen that reads the same data
   reads it through the same options here, so the page's cache shares one
   answer between Home, the brief, Needs you and the Bookings tab. */

export function appsListQuery(api: AppsApi, businessId: string) {
  return queryOptions({ queryKey: keys.appsList(businessId), queryFn: () => api.list() });
}

/** Every request still waiting on the owner, soonest first: one request for
    the whole 91-day horizon. */
export function pendingBookingsQuery(api: AppsApi, businessId: string) {
  return queryOptions({ queryKey: keys.pendingBookings(businessId), queryFn: () => loadPendingBookings(api, new Date()) });
}

/** Reads the apps list again, then the waiting requests only if the fresh
    list says any wait (at 0 the scan is a wasted round trip), and marks
    every cached Bookings window stale: the one on screen reads again now,
    the rest when next shown. After any change, and when a new alert may
    mean a new request. */
export async function refreshApps(client: QueryClient, businessId: string): Promise<void> {
  const windows = client.invalidateQueries({ queryKey: keys.bookingWindows(businessId) });
  await client.invalidateQueries({ queryKey: keys.appsList(businessId) });
  const fresh = client.getQueryData<AppsList>(keys.appsList(businessId));
  const waiting = fresh?.apps.find((app) => app.key === 'bookings')?.pending ?? 0;
  await Promise.all([
    windows,
    client.invalidateQueries({ queryKey: keys.pendingBookings(businessId), refetchType: waiting > 0 ? 'active' : 'none' }),
  ]);
}

export function bookingsConfigQuery(api: AppsApi, businessId: string) {
  return queryOptions({ queryKey: keys.bookingsConfig(businessId), queryFn: () => api.bookingsConfig() });
}

/** Saves the Bookings settings. The server's answer becomes the cached
    config at once (no second read), and the apps list and waiting requests
    are read again, so the Paused label and the counts agree everywhere.
    Never retried: a lost answer is for the owner to reload, not resend. */
export function useSaveBookingsConfig(api: AppsApi) {
  const client = useQueryClient();
  const businessId = useRequiredBusinessId();
  return useMutation({
    mutationFn: (input: BookingsConfigInput) => api.saveBookingsConfig(input),
    onSuccess: (config) => {
      client.setQueryData(keys.bookingsConfig(businessId), config);
      void refreshApps(client, businessId);
    },
  });
}

/** Every booking in one window of Malaysian days (Today, a picked date, or
    31 days of Upcoming). */
export function bookingWindowQuery(api: AppsApi, businessId: string, from: string, days: number) {
  return queryOptions({ queryKey: keys.bookingWindow(businessId, from, days), queryFn: () => loadWindow(api, { from, days }) });
}

/** One booking, as the server has it now. */
export function bookingQuery(api: AppsApi, businessId: string, bookingId: string) {
  return queryOptions({ queryKey: keys.booking(businessId, bookingId), queryFn: () => api.booking(bookingId) });
}

/** Stops every read in flight that could hold this booking as it was before
    a decision: every list, and the booking's own query. A cancelled read
    never lands; each query keeps what it had. */
export async function cancelBookingReads(client: QueryClient, businessId: string, bookingId: string): Promise<void> {
  await Promise.all([
    client.cancelQueries(bookingListsFilter(businessId)),
    client.cancelQueries({ queryKey: keys.booking(businessId, bookingId), exact: true }),
  ]);
}

/** The server's answer for one booking, written where every screen reads it:
    its own query, and every cached list that holds it. Each patched list
    keeps its own `dataUpdatedAt`: this write is not a re-read of that list,
    so it must not make another kept row in it look newer than a later own
    read of that row (`mergeBookingRows` compares against the list's
    timestamp). It also keeps a patched list's `isInvalidated`: `setQueryData`
    clears it as an ordinary successful write would, but this write answers
    for one booking, not the list — a window `refreshApps` left invalidated
    while inactive (a failed action's `onSettled` runs regardless) must still
    refetch the rest of its rows next time it is shown, not read as fresh for
    up to 30 s because this one row happened to get patched first. The
    waiting-requests list keeps only what still waits, as the scan itself
    does. A list that does not hold the booking is left exactly as it was. */
export function writeBooking(client: QueryClient, businessId: string, booking: Booking): void {
  notifyManager.batch(() => {
    client.setQueryData(keys.booking(businessId, booking.id), booking);
    const holds = (rows: Booking[] | undefined): rows is Booking[] => !!rows && rows.some((row) => row.id === booking.id);
    const replace = (rows: Booking[]) => rows.map((row) => (row.id === booking.id ? booking : row));
    for (const query of client.getQueryCache().findAll({ queryKey: keys.bookingWindows(businessId) })) {
      const rows = query.state.data as Booking[] | undefined;
      if (!holds(rows)) continue;
      const wasInvalidated = query.state.isInvalidated;
      client.setQueryData(query.queryKey, replace(rows), { updatedAt: query.state.dataUpdatedAt });
      if (wasInvalidated) void client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' });
    }
    const pending = client.getQueryState<Booking[]>(keys.pendingBookings(businessId));
    if (pending && holds(pending.data)) {
      const wasInvalidated = pending.isInvalidated;
      client.setQueryData(keys.pendingBookings(businessId), replace(pending.data).filter(stillWaiting), { updatedAt: pending.dataUpdatedAt });
      if (wasInvalidated) void client.invalidateQueries({ queryKey: keys.pendingBookings(businessId), exact: true, refetchType: 'none' });
    }
  });
}

/** The booking as the server has it now, after an action that failed or got
    no answer, written everywhere like an action's answer. Cancels a read of
    this one booking already in flight first — a Calendar poll or a focus
    refetch that started before the action — so it cannot win over this
    fresh read, then reads with `api.booking` directly rather than through
    `fetchQuery`: two rereads asked for back to back must never cancel or
    dedupe onto each other (both share the one query key), each must get its
    own server answer, and the cache simply ends with whichever write lands
    last. Rejects when the read fails. */
export async function rereadBooking(client: QueryClient, api: AppsApi, businessId: string, bookingId: string): Promise<Booking> {
  await client.cancelQueries({ queryKey: keys.booking(businessId, bookingId), exact: true });
  const fresh = await api.booking(bookingId);
  writeBooking(client, businessId, fresh);
  return fresh;
}

export interface BookingActionVars {
  id: string;
  action: BookingAction;
}

export function runBookingAction(api: AppsApi, { id, action }: BookingActionVars): Promise<BookingActionResult> {
  return action === 'confirm' || action === 'decline' ? api.decide(id, action)
    : action === 'cancel' ? api.cancel(id) : api.retryCalendar(id);
}

/** Confirm, decline, cancel and Retry Calendar. Reads already in flight are
    cancelled before the request goes and again when the answer arrives, so
    a read that began before the decision cannot land after it; the answer
    is written into the booking's query and every list that holds it; then
    the lists and the apps list are read again, without waiting for them.
    Never retried: a lost answer means re-read and show the truth
    (`rereadBooking`), never send twice. On a failure nothing is read again
    here: the caller re-reads the booking and only then refreshes, since a
    fresh Needs you scan landing first would drop a card someone else just
    decided before the truth about it arrives.
    Each call is its own mutation, so two bookings can be acted on at once. */
export function useBookingAction(api: AppsApi) {
  const client = useQueryClient();
  const businessId = useRequiredBusinessId();
  return useMutation({
    mutationKey: mutationKeys.bookingAction(businessId),
    mutationFn: (vars: BookingActionVars) => runBookingAction(api, vars),
    onMutate: (vars) => cancelBookingReads(client, businessId, vars.id),
    onSuccess: async (result, vars) => {
      await cancelBookingReads(client, businessId, vars.id);
      writeBooking(client, businessId, result.booking);
      void refreshApps(client, businessId);
    },
    retry: false,
  });
}
