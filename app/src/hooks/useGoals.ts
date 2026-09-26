import { useCallback, useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useRepository, type GoalsOverview } from '@/lib/repo';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';

const EMPTY: GoalsOverview = { canManage: false, goals: [] };

/* Only the dev preview and tests render without a signed-in cache (Goals
   needs a signed-in business). They get this client so the query below can
   be declared, disabled, with nothing sent. */
const INERT = new QueryClient();

/** The business's goals, read once for Home's goal card and the Goals screen
    together: a return inside 30 s shows them with no request, and a return
    to the app reads them again. A failed refresh keeps the goals on screen;
    only a first read that fails reports `error`. */
export function useGoals() {
  const repo = useRepository();
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const live = scoped !== undefined && businessId !== null && !!repo.goals;
  const query = useQuery({
    queryKey: keys.goals(businessId ?? 'none'),
    queryFn: () => repo.goals!(),
    enabled: live,
  }, scoped ?? INERT);
  const { refetch } = query;
  /** Reads the goals again, after an edit: the server's answer to an edit
      does not carry the recounted progress. Rejects when the read fails. */
  const reload = useCallback(async (): Promise<GoalsOverview> => {
    if (!live) return EMPTY;
    const result = await refetch({ throwOnError: true });
    return result.data ?? EMPTY;
  }, [live, refetch]);
  const data = live ? query.data ?? null : EMPTY;
  const error = live && query.isError && query.data === undefined;
  return {
    data,
    goals: data?.goals ?? [],
    canManage: data?.canManage === true,
    loading: data === null && !error,
    error,
    reload,
  };
}
