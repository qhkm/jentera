/* ============================================================
   The single source of business state for the dashboard.
   Replaces the engine's module-level BIZ cache + kvRenderAll():
   mutate through these setters and React re-renders what changed.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bumpPotential,
  getBizType,
  getChannels,
  getConnections,
  isPlaybookKey,
  isSetupDone,
  isWorkDone,
  planSeedConnections,
  planToggleConnection,
  recommendations,
  resolveBusiness,
} from '@/lib/business';
import { pendingApprovals } from '@/lib/tools';
import { isRemote, listApprovalsRemote } from '@/lib/api';
import { useMutate, useSnapshot } from '@/lib/repo';
import type { Approval, Business } from '@/lib/types';

/* Writes are fire-and-forget by design; the provider surfaces failures
   centrally, so this only stops an unhandled rejection. */
const noop = () => {};

/** Which stage the command centre should present. */
export type Stage = 'setup' | 'connect' | 'operating';

export interface BusinessState {
  bizKey: string;
  business: Business;
  connections: string[];
  channels: string[] | null;
  setupDone: boolean;
  potential: number;
  stage: Stage;
  approvals: Approval[];
  needsYouCount: number;
  recommended: ReturnType<typeof recommendations>;
  switchBusiness: (key: string) => void;
  toggleConn: (name: string) => void;
  completeWork: (index: number) => void;
  workDone: (index: number) => boolean;
  refresh: () => void;
}

export function useBusiness(): BusinessState {
  const snap = useSnapshot();
  const mutate = useMutate();
  const bizKey = getBizType(snap);

  /* Remote approvals live outside the snapshot, so a manual refetch still
     needs a tick to hang its effect dependency on. */
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Seed default connections once per business, before first paint. `snap` is
  // deliberately left out of the deps: it gets a new identity after *every*
  // mutate anywhere in the app (theme, language, profile, permissions,
  // approvals, ...), and this effect must not re-run on those. If it did,
  // a user disconnecting their last connection would see it undone in the
  // same render cycle, because `planSeedConnections` treats an empty list as
  // "never seeded" — see the incident this guards against in
  // .superpowers/sdd/2026-08-21-slice-0-consolidation/task-5-report.md.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const seed = planSeedConnections(snap, bizKey);
    if (seed) void mutate((r) => r.setConnections(seed));
  }, [bizKey, mutate]);

  const business = useMemo(() => resolveBusiness(snap, bizKey), [snap, bizKey]);
  const connections = getConnections(snap);
  const channels = getChannels(snap);
  /* Local is synchronous; remote resolves into state. Same shape either way. */
  const localApprovals = useMemo(() => (isRemote() ? [] : pendingApprovals(snap)), [snap]);
  const [remoteApprovals, setRemoteApprovals] = useState<Approval[]>([]);

  useEffect(() => {
    if (!isRemote()) return;
    let cancelled = false;
    listApprovalsRemote(bizKey)
      .then((rows) => {
        if (!cancelled) setRemoteApprovals(rows);
      })
      .catch(() => {
        /* Backend unreachable — fall back to showing nothing pending. */
        if (!cancelled) setRemoteApprovals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bizKey, tick]);

  const approvals = isRemote() ? remoteApprovals : localApprovals;
  const setupDone = isSetupDone(snap);
  const recommended = useMemo(() => recommendations(business), [business]);

  const needsYouCount = useMemo(
    () =>
      business.work.filter((w, i) => w.tag === 'needs you' && !isWorkDone(snap, bizKey, i)).length,
    [business.work, snap, bizKey],
  );

  const potential = useMemo(
    () => bumpPotential(snap, business.potential),
    [snap, business.potential],
  );

  const stage: Stage = useMemo(() => {
    if (!setupDone) return 'setup';
    const live = channels ?? connections;
    return live.length ? 'operating' : 'connect';
  }, [setupDone, channels, connections]);

  const switchBusiness = useCallback(
    (key: string) => {
      if (isPlaybookKey(key)) void mutate((r) => r.setBizType(key));
    },
    [mutate],
  );

  const toggleConn = useCallback(
    (name: string) => {
      void mutate((r) => r.setConnections(planToggleConnection(snap, name))).catch(noop);
    },
    [mutate, snap],
  );

  const completeWork = useCallback(
    (index: number) => {
      void mutate((r) => r.markWorkDone(bizKey, index)).catch(noop);
    },
    [mutate, bizKey],
  );

  const workDone = useCallback(
    (index: number) => isWorkDone(snap, bizKey, index),
    [snap, bizKey],
  );

  return {
    bizKey,
    business,
    connections,
    channels,
    setupDone,
    potential,
    stage,
    approvals,
    needsYouCount,
    recommended,
    switchBusiness,
    toggleConn,
    completeWork,
    workDone,
    refresh,
  };
}
