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
  isSetupDone,
  isWorkDone,
  markWorkDone,
  recommendations,
  resolveBusiness,
  seedConnections,
  setBizType,
  toggleConnection,
} from '@/lib/business';
import { pendingApprovals } from '@/lib/tools';
import type { Approval, Business } from '@/lib/types';

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
  const [bizKey, setKey] = useState(getBizType);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Seed default connections once per business, before first paint.
  useEffect(() => {
    seedConnections(bizKey);
    refresh();
  }, [bizKey, refresh]);

  const business = useMemo(() => resolveBusiness(bizKey), [bizKey, tick]);
  const connections = useMemo(() => getConnections(), [tick]);
  const channels = useMemo(() => getChannels(), [tick]);
  const approvals = useMemo(() => pendingApprovals(), [tick]);
  const setupDone = useMemo(() => isSetupDone(), [tick]);
  const recommended = useMemo(() => recommendations(business), [business]);

  const needsYouCount = useMemo(
    () => business.work.filter((w, i) => w.tag === 'needs you' && !isWorkDone(bizKey, i)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [business.work, bizKey, tick],
  );

  const potential = useMemo(
    () => bumpPotential(business.potential),
    [business.potential, tick],
  );

  const stage: Stage = useMemo(() => {
    if (!setupDone) return 'setup';
    const live = channels ?? connections;
    return live.length ? 'operating' : 'connect';
  }, [setupDone, channels, connections]);

  const switchBusiness = useCallback(
    (key: string) => {
      if (setBizType(key)) setKey(key);
    },
    [],
  );

  const toggleConn = useCallback(
    (name: string) => {
      toggleConnection(name);
      refresh();
    },
    [refresh],
  );

  const completeWork = useCallback(
    (index: number) => {
      markWorkDone(bizKey, index);
      refresh();
    },
    [bizKey, refresh],
  );

  const workDone = useCallback(
    (index: number) => isWorkDone(bizKey, index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bizKey, tick],
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
