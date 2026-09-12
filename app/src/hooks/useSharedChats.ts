/* ============================================================
   The workspaces this person is in and the chats inside each, read from
   the server. A person's own chats live in their browser; these are the
   ones colleagues opened, which this browser never saw typed. Loaded only
   where the plan applies, and re-read on demand after a turn lands.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { useRepository } from '@/lib/repo';
import type { Workspace, WorkspaceChat } from '@/lib/repo';

export interface SharedWorkspace extends Workspace {
  chats: WorkspaceChat[];
}

export function useSharedChats(enabled: boolean): { workspaces: SharedWorkspace[]; loading: boolean; reload: () => void } {
  const repo = useRepository();
  const [workspaces, setWorkspaces] = useState<SharedWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !repo.workspaces || !repo.workspaceChats) {
      setWorkspaces([]);
      return;
    }
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const { workspaces: all } = await repo.workspaces!();
        const mine = all.filter((w) => w.member);
        const withChats = await Promise.all(mine.map(async (w) => ({
          ...w, chats: await repo.workspaceChats!(w.id).catch(() => [] as WorkspaceChat[]),
        })));
        if (live) setWorkspaces(withChats);
      } catch {
        if (live) setWorkspaces([]);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [enabled, repo, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { workspaces, loading, reload };
}
