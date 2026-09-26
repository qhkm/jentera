import { useCallback, useContext, useState } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type { Routine, OccurrencePage, RoutinesApi } from '@/lib/routines/types';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';

type Detail = { routine: Routine; history: OccurrencePage };

/** How often the list and the open routine are read while a run is under way. */
export const ROUTINE_POLL_MS = 10_000;
const UNDER_WAY = ['queued', 'working', 'needs_approval'];

/* Only tests and the dev preview render without a signed-in cache; Routines
   is a signed-in feature. They get this client so the queries can be
   declared, disabled, with nothing sent. */
const INERT = new QueryClient();

/** Reads only. Polling observes already-admitted work; it never schedules jobs.

    The list and the open routine (with the first page of its history) are
    cache entries: a return to Routines inside 30 s asks for nothing, a
    return to the app reads them again, and while a run is under way they
    are read every 10 s — only while Routines is open and on screen.
    `refresh()` reads both again whatever their age and resolves once both
    have landed; the save and reconcile flows depend on that. `error` is the
    latest list read's failure, with the last list kept in `data`. Reads are
    not retried: a RoutineError carries its own meaning (sign in again, not
    found, uncertain), and a failed read is shown at once, as it always was. */
export function useRoutines(api: RoutinesApi, active: boolean, selectedId: string | null) {
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const client = scoped ?? INERT;
  const live = scoped !== undefined && businessId !== null;
  const biz = businessId ?? 'none';

  const list = useQuery({
    queryKey: keys.routines(biz),
    queryFn: () => api.list(),
    enabled: live && active,
    retry: false,
    refetchInterval: (query) => (active && query.state.data?.routines.some(
      (routine) => routine.lastOccurrence && UNDER_WAY.includes(routine.lastOccurrence.status),
    ) ? ROUTINE_POLL_MS : false),
    refetchIntervalInBackground: false,
  }, client);
  const queued = list.data?.routines.some((r) => r.lastOccurrence && UNDER_WAY.includes(r.lastOccurrence.status)) ?? false;

  const detailKey = keys.routine(biz, selectedId ?? 'none');
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: async (): Promise<Detail> => {
      const [routine, history] = await Promise.all([api.read(selectedId!), api.occurrences(selectedId!)]);
      return { routine, history };
    },
    enabled: live && active && selectedId !== null,
    retry: false,
    refetchInterval: active && queued ? ROUTINE_POLL_MS : false,
    refetchIntervalInBackground: false,
  }, client);

  const [more, setMore] = useState<{ key: string; loading: boolean; error: boolean }>({ key: '', loading: false, error: false });
  const moreFor = `${biz}/${selectedId ?? ''}`;
  const moreState = more.key === moreFor ? more : { loading: false, error: false };

  const { refetch: refetchList } = list;
  const { refetch: refetchDetail } = detail;
  const refresh = useCallback(async () => {
    setMore({ key: '', loading: false, error: false });
    await Promise.all([refetchList(), selectedId ? refetchDetail() : undefined]);
  }, [refetchList, refetchDetail, selectedId]);

  /* A page that arrives after the open routine was read again belongs to a
     history that is gone, and is dropped. */
  const loadMore = useCallback(async () => {
    const current = detail.data;
    if (!selectedId || !current?.history.nextCursor || moreState.loading || detail.isFetching) return;
    const readAt = detail.dataUpdatedAt;
    setMore({ key: moreFor, loading: true, error: false });
    try {
      const page = await api.occurrences(selectedId, current.history.nextCursor);
      if (client.getQueryState(detailKey)?.dataUpdatedAt !== readAt) return;
      client.setQueryData<Detail>(detailKey, (latest) => {
        if (!latest || latest.routine.id !== selectedId) return latest;
        const seen = new Set(latest.history.occurrences.map((item) => item.id));
        return { ...latest, history: { ...page, occurrences: [
          ...latest.history.occurrences, ...page.occurrences.filter((item) => !seen.has(item.id)),
        ] } };
      }, { updatedAt: readAt });
      setMore({ key: moreFor, loading: false, error: false });
    } catch {
      if (client.getQueryState(detailKey)?.dataUpdatedAt === readAt) setMore({ key: moreFor, loading: false, error: true });
    }
  }, [api, client, selectedId, moreFor, detail.data, detail.dataUpdatedAt, detail.isFetching, moreState.loading]);

  return {
    data: list.data ?? null,
    error: list.isFetching ? null : list.error,
    loading: list.isFetching || (list.data === undefined && !list.isError),
    detail: selectedId && detail.data?.routine.id === selectedId ? detail.data : null,
    detailError: detail.isFetching ? null : detail.error,
    detailLoading: selectedId !== null && (detail.isFetching || (detail.data === undefined && !detail.isError)),
    moreError: moreState.error,
    moreLoading: moreState.loading,
    refresh,
    loadMore,
  };
}
