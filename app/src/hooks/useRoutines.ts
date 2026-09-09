import { useCallback, useEffect, useRef, useState } from 'react';
import type { Routine, RoutineList, OccurrencePage, RoutinesApi } from '@/lib/routines/types';

/** Reads only. Polling observes already-admitted work; it never schedules jobs. */
export function useRoutines(api: RoutinesApi, active: boolean, selectedId: string | null) {
  const [data, setData] = useState<RoutineList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ routine: Routine; history: OccurrencePage } | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const listEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const morePending = useRef(false);

  const refreshList = useCallback(async () => {
    const epoch = ++listEpoch.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.list();
      if (epoch === listEpoch.current) setData(next);
    } catch (e) {
      if (epoch === listEpoch.current) setError(e);
    } finally {
      if (epoch === listEpoch.current) setLoading(false);
    }
  }, [api]);

  const refreshDetail = useCallback(async () => {
    const epoch = ++detailEpoch.current;
    setDetailError(null);
    setMoreError(false);
    setMoreLoading(false);
    morePending.current = false;
    if (!selectedId) { setDetail(null); setDetailLoading(false); return; }
    setDetailLoading(true);
    try {
      const [routine, history] = await Promise.all([api.read(selectedId), api.occurrences(selectedId)]);
      if (epoch === detailEpoch.current) setDetail({ routine, history });
    } catch (e) {
      if (epoch === detailEpoch.current) setDetailError(e);
    } finally {
      if (epoch === detailEpoch.current) setDetailLoading(false);
    }
  }, [api, selectedId]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshList(), refreshDetail()]);
  }, [refreshList, refreshDetail]);

  useEffect(() => {
    if (active) void refresh();
    return () => { listEpoch.current++; detailEpoch.current++; };
  }, [active, refresh]);

  const queued = data?.routines.some((r) => r.lastOccurrence && ['queued', 'working', 'needs_approval'].includes(r.lastOccurrence.status));
  useEffect(() => {
    if (!active) return;
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    const interval = queued ? window.setInterval(visible, 10_000) : undefined;
    return () => { document.removeEventListener('visibilitychange', visible); window.clearInterval(interval); };
  }, [active, queued, refresh]);

  const loadMore = useCallback(async () => {
    if (!selectedId || !detail?.history.nextCursor || morePending.current || detailLoading) return;
    const epoch = detailEpoch.current;
    morePending.current = true;
    setMoreLoading(true);
    setMoreError(false);
    try {
      const page = await api.occurrences(selectedId, detail.history.nextCursor);
      if (epoch !== detailEpoch.current) return;
      setDetail((current) => {
        if (!current || current.routine.id !== selectedId) return current;
        const seen = new Set(current.history.occurrences.map((item) => item.id));
        return { ...current, history: { ...page, occurrences: [
          ...current.history.occurrences, ...page.occurrences.filter((item) => !seen.has(item.id)),
        ] } };
      });
    } catch {
      if (epoch === detailEpoch.current) setMoreError(true);
    } finally {
      if (epoch === detailEpoch.current) { morePending.current = false; setMoreLoading(false); }
    }
  }, [api, selectedId, detail, detailLoading]);

  return { data, error, loading, detail: detail?.routine.id === selectedId ? detail : null,
    detailError, detailLoading, moreError, moreLoading, refresh, loadMore };
}
