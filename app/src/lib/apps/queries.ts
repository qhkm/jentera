import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { keys } from '@/lib/query/keys';
import { useRequiredBusinessId } from '@/lib/query/scope';
import { loadPendingBookings } from './bookings';
import type { AppsApi, AppsList, BookingsConfigInput } from './types';

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
