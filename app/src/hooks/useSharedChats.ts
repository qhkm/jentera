/* ============================================================
   The workspaces this person is in and the chats inside each, read from
   the server. A person's own chats live in their browser; these are the
   ones colleagues opened, which this browser never saw typed. Loaded only
   where the plan applies.
   ============================================================ */
import { useCallback, useContext } from 'react';
import { QueryClient, QueryClientContext, queryOptions, useQuery } from '@tanstack/react-query';
import { useRepository } from '@/lib/repo';
import type { Repository, Workspace, WorkspaceChat } from '@/lib/repo';
import { STALE_MS } from '@/lib/query/client';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';

export interface SharedWorkspace extends Workspace {
  chats: WorkspaceChat[];
}

const NONE: SharedWorkspace[] = [];

/** The business's workspaces as /api/workspaces answers, read once for the
    chat screen's shared chats and the Team settings panel. `staleTime` is
    stated because `fetchQuery` (how shared chats reads it) does not take
    the client's default: without it every shared-chats read would ask
    again. */
export function workspacesQuery(repo: Repository, businessId: string) {
  return queryOptions({
    queryKey: keys.workspaces(businessId),
    queryFn: () => repo.workspaces!(),
    staleTime: STALE_MS,
  });
}

/* Only tests and the dev preview render without a signed-in cache; shared
   chats need a signed-in team business. They get this client so the query
   can be declared, disabled, with nothing sent. */
const INERT = new QueryClient();

/** One cache entry for the chat screen, built on the workspaces the Team
    panel reads too: a return to the app after 30 s reads it again, which is
    how a colleague's new chat arrives; a change made in the Team panel
    reads it again at once; a failed read keeps the list already shown. A
    workspace whose chats cannot be read is still listed, with none. */
export function useSharedChats(enabled: boolean): { workspaces: SharedWorkspace[]; loading: boolean; reload: () => void } {
  const repo = useRepository();
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const able = enabled && !!repo.workspaces && !!repo.workspaceChats;
  const live = able && scoped !== undefined && businessId !== null;
  const client = scoped ?? INERT;
  const query = useQuery({
    queryKey: keys.sharedChats(businessId ?? 'none'),
    queryFn: async (): Promise<SharedWorkspace[]> => {
      const { workspaces: all } = await client.fetchQuery(workspacesQuery(repo, businessId!));
      return Promise.all(all.filter((w) => w.member).map(async (w) => ({
        ...w, chats: await repo.workspaceChats!(w.id).catch(() => [] as WorkspaceChat[]),
      })));
    },
    enabled: live,
  }, client);
  const { refetch } = query;
  /* Asked for on purpose, so the workspaces underneath are read again too,
     however fresh: fetchQuery would otherwise hand back the cached list. */
  const reload = useCallback(() => {
    if (!live) return;
    void client.invalidateQueries({ queryKey: keys.workspaces(businessId!), refetchType: 'none' }).then(() => refetch());
  }, [live, client, businessId, refetch]);
  return { workspaces: able ? query.data ?? NONE : NONE, loading: live && query.isFetching, reload };
}
