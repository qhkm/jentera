import { QueryClient } from '@tanstack/react-query';
import { AppsError } from '@/lib/apps/api';

/* The server-data cache for a signed-in page (docs/superpowers/specs/
   2026-09-25-query-cache-bookings-path-design.md). One client per page,
   created by RepositoryGate, kept in memory only: nothing here is ever
   written to device storage, and a full reload starts empty. */

/** A revisit inside this window shows the cache without a request. */
export const STALE_MS = 30_000;
/** Data no screen has shown for this long is dropped. */
export const GC_MS = 30 * 60_000;

/** Whether a failed read can be worth one more try. Apps reads say so
    through AppsError: a network failure (status 0), a 5xx, or an answer we
    could not read. A 4xx never changes on retry. The notifications module
    throws a plain Error with no status, so its reads retry on any failure. */
export function retryableRead(error: unknown): boolean {
  if (error instanceof AppsError) {
    return error.status === 0 || error.status >= 500 || error.code === 'INVALID_RESPONSE';
  }
  return true;
}

/** A read retries once, and only when `retryableRead` allows it. */
export function retryOnce(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && retryableRead(error);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      /* networkMode 'always' on both: TanStack's default ('online') holds a
         request while the browser reports offline and sends it on
         reconnect. A confirm tapped in a lift would go out minutes later,
         with nobody left on the screen to send the customer the WhatsApp
         message, and a first load offline would spin for ever. Instead the
         request goes, fails at once, and says so — as before the cache. */
      queries: {
        staleTime: STALE_MS,
        gcTime: GC_MS,
        refetchOnWindowFocus: true,
        retry: retryOnce,
        networkMode: 'always',
      },
      /* Confirm, decline, cancel and a settings save are never sent twice:
         a lost answer means re-read and show the truth. */
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
