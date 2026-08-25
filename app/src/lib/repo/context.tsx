/* ============================================================
   Repository access for components.

   The snapshot is loaded once and held in state, so reads stay
   synchronous at every call site. Writes go through useMutate,
   which refreshes the snapshot afterwards.
   ============================================================ */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LocalRepository } from './local';
import type { BusinessSnapshot, Repository } from './types';

interface Ctx {
  repository: Repository;
  snapshot: BusinessSnapshot;
  refresh: () => Promise<void>;
  reportWriteError: (e: Error) => void;
}

export type RepoStatus = 'loading' | 'ready' | 'error';

interface StatusCtx {
  status: RepoStatus;
  /** The load failure that blocked startup, or the most recent write failure. */
  error: Error | null;
  retry: () => void;
}

const StatusContext = createContext<StatusCtx | null>(null);

const RepoContext = createContext<Ctx | null>(null);

export function RepositoryProvider({
  repository,
  children,
}: {
  repository?: Repository;
  children: ReactNode;
}) {
  /* Bind one repository for the provider's lifetime. `useMemo` would
     recompute whenever `repository`'s identity changes — which happens on
     every render for a caller who writes `<RepositoryProvider repository=
     {new LocalRepository()}>` inline — and that recomputation would cascade
     into `refresh` and re-fire the hydration effect below. A ref sidesteps
     that: the first non-null value wins and later renders are ignored.
     Swapping repositories at runtime is not supported — remount with a
     `key` if a different one is genuinely needed. */
  const repoRef = useRef<Repository | null>(null);
  if (repoRef.current === null) {
    repoRef.current = repository ?? new LocalRepository();
  }
  const repo = repoRef.current;
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  /* A rejecting load() used to leave snapshot null forever, and the
     `if (!value) return null` below then rendered a permanently blank
     app — no spinner, no message, no retry. Unreachable with
     LocalRepository, which cannot throw; routine the moment a network
     sits behind this. */
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await repo.load());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  /* Writes reject rather than resolving silently, but every call site
     uses fire-and-forget `void mutate(...)`. Routing failures here gives
     them one place to surface without each caller inventing its own. */
  const reportWriteError = useCallback((e: Error) => setError(e), []);

  const value = useMemo(
    () => (snapshot ? { repository: repo, snapshot, refresh, reportWriteError } : null),
    [repo, snapshot, refresh, reportWriteError],
  );

  const status: RepoStatus = snapshot ? 'ready' : error ? 'error' : 'loading';
  const statusValue = useMemo(() => ({ status, error, retry }), [status, error, retry]);

  return (
    <StatusContext.Provider value={statusValue}>
      {value ? (
        <RepoContext.Provider value={value}>{children}</RepoContext.Provider>
      ) : status === 'error' ? (
        <div role="alert" className="card" style={{ margin: '2rem', padding: '1.5rem' }}>
          <p>Could not load your business. {error?.message}</p>
          <button className="btn" onClick={retry} type="button">
            Try again
          </button>
        </div>
      ) : null}
    </StatusContext.Provider>
  );
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

/**
 * Load and write status. Unlike useSnapshot this works outside a loaded
 * provider, which is the point — something has to render the failure.
 */
export function useRepoStatus(): StatusCtx {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error('useRepoStatus requires a <RepositoryProvider> above it.');
  return ctx;
}

/** Run a write, then refresh the snapshot so the UI reflects it. */
export function useMutate(): (fn: (r: Repository) => Promise<void>) => Promise<void> {
  const { repository, refresh, reportWriteError } = useCtx();
  return useCallback(
    async (fn) => {
      try {
        await fn(repository);
      } catch (e) {
        // Surface it, then rethrow: a caller that awaits still sees the
        // failure, and one that fire-and-forgets no longer loses it.
        reportWriteError(e instanceof Error ? e : new Error(String(e)));
        throw e;
      }
      await refresh();
    },
    [repository, refresh, reportWriteError],
  );
}
