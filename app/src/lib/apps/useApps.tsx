import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessId } from '@/lib/query/scope';
import { appsListQuery, pendingBookingsQuery, refreshApps } from './queries';
import type { AppsApi, AppsList, Booking, InstalledApp } from './types';

/* One source for the business's apps, so Home, the bell, the daily brief and
   the Bookings screen agree. The list and the waiting requests are queries
   in the page's cache (lib/query): a revisit inside 30 s shows them with no
   request, and a return to the app after that reads them again quietly.
   They are also read again when the unread alerts count rises (a new
   booking request arrives as an alert, and the bell polls while the app
   stays on screen), and after any change (refresh). */

export interface AppsState {
  /** Apps are on for this owner and the repository can reach them. */
  enabled: boolean;
  api: AppsApi | null;
  list: AppsList | null;
  /** Pending requests the owner can still decide, soonest first; null until known or when Bookings is not installed. */
  pending: Booking[] | null;
  loading: boolean;
  error: boolean;
  refresh(): Promise<void>;
}

const OFF: AppsState = {
  enabled: false, api: null, list: null, pending: null, loading: false, error: false, refresh: async () => {},
};
/** One empty list, so "nothing waits" keeps its identity between renders. */
const NONE: Booking[] = [];
const AppsContext = createContext<AppsState>(OFF);

export function AppsProvider({ api, unread = null, children }: {
  api: AppsApi | null;
  /** The bell's unread count, or null while it is unknown (loading). */
  unread?: number | null;
  children: ReactNode;
}) {
  const businessId = useBusinessId();
  /* Off without an API (the demo, or apps not on for this owner) or without
     a signed-in business to key the cache by. Neither changes while a page
     is open, so this never swaps a mounted tree for another. */
  if (!api || !businessId) return <AppsContext.Provider value={OFF}>{children}</AppsContext.Provider>;
  return <LiveAppsProvider api={api} businessId={businessId} unread={unread}>{children}</LiveAppsProvider>;
}

function LiveAppsProvider({ api, businessId, unread, children }: {
  api: AppsApi;
  businessId: string;
  unread: number | null;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const list = useQuery(appsListQuery(api, businessId));
  const bookings = list.data?.apps.find((app) => app.key === 'bookings');
  /* The list's count is every pending request not yet started, which is
     everything the scan could find. At 0 there is nothing to ask for, and
     whatever an earlier scan left in the cache no longer waits. */
  const scanning = (bookings?.pending ?? 0) > 0;
  const scan = useQuery({ ...pendingBookingsQuery(api, businessId), enabled: scanning });
  const pending = !bookings ? null : !scanning ? NONE : scan.data ?? null;

  const refresh = useCallback(() => refreshApps(client, businessId), [client, businessId]);

  /* The first known count is what the mount-time load already covered; after
     that, each rise is something new. A count that falls (read) or goes
     unknown (a poll in flight) is not. */
  const lastUnread = useRef<number | null>(null);
  useEffect(() => {
    if (unread === null) return;
    const before = lastUnread.current;
    lastUnread.current = unread;
    if (before !== null && unread > before) void refresh();
  }, [unread, refresh]);

  const listData = list.data ?? null;
  const loading = list.isFetching || (scanning && scan.isFetching);
  const error = list.isError || (scanning && scan.isError);
  const value = useMemo<AppsState>(
    () => ({ enabled: true, api, list: listData, pending, loading, error, refresh }),
    [api, listData, pending, loading, error, refresh],
  );
  return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}

export function useApps(): AppsState {
  return useContext(AppsContext);
}

/** Home's option B (spec D2): the installed apps, or null to keep today's Home. */
export function useHomeApps(): InstalledApp[] | null {
  const apps = useApps();
  return apps.enabled && apps.list && apps.list.apps.length > 0 ? apps.list.apps : null;
}
