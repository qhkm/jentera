import { useCallback, useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useRepository } from '@/lib/repo';
import type { Activity } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';

/**
 * - `real`    — these are this business's own figures.
 * - `pending` — signed in, but the answer has not arrived. Render the
 *   real layout empty; never the demo.
 * - `error`   — the server answered with a failure; offer a retry.
 * - `demo`    — nobody is signed in, so the illustration is the point.
 */
export type ActivityMode = 'real' | 'pending' | 'error' | 'demo';

export interface ActivityState {
  /** Null while loading, failed, or when this session has no server to ask. */
  data: Activity | null;
  /** True while figures are being read, the first time or again. */
  loading: boolean;
  error: Error | null;
  mode: ActivityMode;
  /** True when these are real figures for this business. */
  real: boolean;
  /** Reads the figures again in the background; the current ones stay. */
  reload: () => void;
  /** When this browser last successfully fetched these figures. */
  updatedAt: number | null;
}

/* Only tests and the dev preview are signed in without a cache (the gate
   builds one for every signed-in page). They get this client so the query
   can be declared, disabled, with nothing sent. */
const INERT = new QueryClient();

/**
 * The business's activity, read once for everything that shows it — the
 * sidebar, Home, the brief, Activity, chat and task detail share one cache
 * entry and settle at the same moment. A return inside 30 s shows it with
 * no request; a return to the app reads it again; a refresh keeps the
 * current figures on screen until the new ones land. A failed refresh
 * keeps them too: `error` is only ever a first read with nothing to show.
 */
export function useActivity(): ActivityState {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const live = signedIn && scoped !== undefined && businessId !== null;
  const query = useQuery({
    queryKey: keys.activity(businessId ?? 'none'),
    queryFn: () => repo.activity(),
    enabled: live,
  }, scoped ?? INERT);
  const { refetch } = query;
  const reload = useCallback(() => {
    if (live) void refetch();
  }, [live, refetch]);

  const data = signedIn ? query.data ?? null : null;
  const failed = data === null && query.isError && !query.isFetching;
  const mode: ActivityMode = !signedIn ? 'demo' : data !== null ? 'real' : failed ? 'error' : 'pending';
  return {
    data,
    loading: signedIn && (query.isFetching || (data === null && !failed)),
    error: failed ? query.error : null,
    mode,
    real: mode === 'real',
    reload,
    updatedAt: mode === 'real' ? query.dataUpdatedAt : null,
  };
}
