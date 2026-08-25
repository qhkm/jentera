/* ============================================================
   Repository access for components.

   The snapshot is loaded once and held in state, so reads stay
   synchronous at every call site. Writes go through useMutate,
   which refreshes the snapshot afterwards.
   ============================================================ */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LocalRepository } from './local';
import type { BusinessSnapshot, Repository } from './types';

interface Ctx {
  repository: Repository;
  snapshot: BusinessSnapshot;
  refresh: () => Promise<void>;
}

const RepoContext = createContext<Ctx | null>(null);

export function RepositoryProvider({
  repository,
  children,
}: {
  repository?: Repository;
  children: ReactNode;
}) {
  const repo = useMemo(() => repository ?? new LocalRepository(), [repository]);
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);

  const refresh = useCallback(async () => {
    setSnapshot(await repo.load());
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => (snapshot ? { repository: repo, snapshot, refresh } : null),
    [repo, snapshot, refresh],
  );

  /* Nothing renders until state exists. Every consumer may then assume
     a snapshot, which is what keeps reads synchronous. */
  if (!value) return null;

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

function useCtx(): Ctx {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useSnapshot/useRepository require a <RepositoryProvider> above them.');
  }
  return ctx;
}

export function useRepository(): Repository {
  return useCtx().repository;
}

export function useSnapshot(): BusinessSnapshot {
  return useCtx().snapshot;
}

/** Run a write, then refresh the snapshot so the UI reflects it. */
export function useMutate(): (fn: (r: Repository) => Promise<void>) => Promise<void> {
  const { repository, refresh } = useCtx();
  return useCallback(
    async (fn) => {
      await fn(repository);
      await refresh();
    },
    [repository, refresh],
  );
}
