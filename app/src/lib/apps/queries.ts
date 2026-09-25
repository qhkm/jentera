import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { keys } from '@/lib/query/keys';
import { loadPendingBookings } from './bookings';
import type { AppsApi, AppsList } from './types';

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
