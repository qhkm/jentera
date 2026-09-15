import { useCallback, useEffect, useState } from 'react';
import { useRepository, type GoalsOverview } from '@/lib/repo';

const EMPTY: GoalsOverview = { canManage: false, goals: [] };

export function useGoals(enabled = true) {
  const repo = useRepository();
  const [data, setData] = useState<GoalsOverview | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(() => {
    if (!enabled || !repo.goals) {
      setData(EMPTY);
      setError(false);
      return Promise.resolve(EMPTY);
    }
    setError(false);
    return repo.goals().then((next) => {
      setData(next);
      return next;
    }).catch((reason) => {
      setError(true);
      throw reason;
    });
  }, [enabled, repo]);
  useEffect(() => {
    let live = true;
    if (!enabled || !repo.goals) { setData(EMPTY); return; }
    setError(false);
    repo.goals().then((next) => { if (live) setData(next); })
      .catch(() => { if (live) { setData(EMPTY); setError(true); } });
    return () => { live = false; };
  }, [enabled, repo]);
  return {
    data,
    goals: data?.goals ?? [],
    canManage: data?.canManage === true,
    loading: data === null,
    error,
    reload,
  };
}
