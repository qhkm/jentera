import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadPendingBookings } from './bookings';
import type { AppsApi, AppsList, Booking, InstalledApp } from './types';

/* One source for the business's apps, so Home, the bell, the daily brief and
   the Bookings screen agree. It loads when apps are on, again when the app
   returns to the foreground, again when the unread alerts count rises (a new
   booking request arrives as an alert, and the bell polls while the app stays
   on screen), and again after any change (refresh). */

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
const AppsContext = createContext<AppsState>(OFF);

export function AppsProvider({ api, unread = null, children }: {
  api: AppsApi | null;
  /** The bell's unread count, or null while it is unknown (loading). */
  unread?: number | null;
  children: ReactNode;
}) {
  const [list, setList] = useState<AppsList | null>(null);
  const [pending, setPending] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!api) return;
    const mine = ++generation.current;
    setLoading(true);
    try {
      const next = await api.list();
      const installed = next.apps.some((app) => app.key === 'bookings');
      const nextPending = installed ? await loadPendingBookings(api, new Date()) : null;
      if (mine !== generation.current) return;
      setList(next);
      setPending(nextPending);
      setError(false);
    } catch {
      if (mine === generation.current) setError(true);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      setList(null);
      setPending(null);
      return;
    }
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [api, refresh]);

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

  const value: AppsState = api ? { enabled: true, api, list, pending, loading, error, refresh } : OFF;
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
