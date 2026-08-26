/* ============================================================
   How much this person wants to be shown.

   A property of the person, not the business: two people running one
   shop need not want the same amount of detail, and the owner who
   wants the trace should not impose it on staff who do not.

   Shared through context rather than held per call site. The first
   version was a plain hook, so Shell and ActivityView each kept their
   own copy — the header toggle flipped and the traces below it stayed
   open, because nothing told them. State that two components must
   agree on is state that has to live in one place.
   ============================================================ */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRepository } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';

export type DetailLevel = 'beginner' | 'advanced';

interface Ctx {
  level: DetailLevel;
  advanced: boolean;
  /** Absent in the demo, where there is nothing technical to reveal. */
  canChange: boolean;
  set: (level: DetailLevel) => void;
}

const DetailContext = createContext<Ctx>({
  level: 'beginner',
  advanced: false,
  canChange: false,
  set: () => {},
});

export function DetailLevelProvider({ children }: { children: ReactNode }) {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const [level, setLevel] = useState<DetailLevel>('beginner');

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void repo.detailLevel().then(
      (l) => live && setLevel(l),
      () => {
        /* Falling back to beginner is the safe direction: showing less
           than someone asked for is a mild annoyance, showing raw
           traces to someone who did not is a confusing product. */
      },
    );
    return () => {
      live = false;
    };
  }, [repo, signedIn]);

  const set = useCallback(
    (next: DetailLevel) => {
      // Optimistic: the toggle should feel instant, and a failed write
      // is corrected on the next load rather than blocking the click.
      setLevel(next);
      void repo.setDetailLevel(next).catch(() => {});
    },
    [repo],
  );

  const value = useMemo(
    () => ({ level, advanced: level === 'advanced', canChange: signedIn, set }),
    [level, signedIn, set],
  );

  return <DetailContext.Provider value={value}>{children}</DetailContext.Provider>;
}

export function useDetailLevel(): Ctx {
  return useContext(DetailContext);
}
