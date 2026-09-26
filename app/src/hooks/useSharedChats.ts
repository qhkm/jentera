/* ============================================================
   The workspaces this person is in and the chats inside each, read from
   the server. A person's own chats live in their browser; these are the
   ones colleagues opened, which this browser never saw typed. Loaded only
   where the plan applies.
   ============================================================ */
import { useCallback, useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useRepository } from '@/lib/repo';
import type { Workspace, WorkspaceChat } from '@/lib/repo';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';

export interface SharedWorkspace extends Workspace {
  chats: WorkspaceChat[];
}

const NONE: SharedWorkspace[] = [];

/* Only tests and the dev preview render without a signed-in cache; shared
   chats need a signed-in team business. They get this client so the query
   can be declared, disabled, with nothing sent. */
const INERT = new QueryClient();

/** One cache entry for the chat screen: a return to the app after 30 s
    reads it again, which is how a colleague's new chat arrives, and a
    failed read keeps the list already shown. A workspace whose chats
    cannot be read is still listed, with none. */
export function useSharedChats(enabled: boolean): { workspaces: SharedWorkspace[]; loading: boolean; reload: () => void } {
  const repo = useRepository();
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const able = enabled && !!repo.workspaces && !!repo.workspaceChats;
  const live = able && scoped !== undefined && businessId !== null;
  const query = useQuery({
    queryKey: keys.sharedChats(businessId ?? 'none'),
    queryFn: async (): Promise<SharedWorkspace[]> => {
      const { workspaces: all } = await repo.workspaces!();
      return Promise.all(all.filter((w) => w.member).map(async (w) => ({
        ...w, chats: await repo.workspaceChats!(w.id).catch(() => [] as WorkspaceChat[]),
      })));
    },
    enabled: live,
  }, scoped ?? INERT);
  const { refetch } = query;
  const reload = useCallback(() => {
    if (live) void refetch();
  }, [live, refetch]);
  return { workspaces: able ? query.data ?? NONE : NONE, loading: live && query.isFetching, reload };
}
