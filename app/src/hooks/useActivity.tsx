/* ============================================================
   Real work records and counters, when there is a server to ask.

   Home and Activity used to render playbook illustrations — plausible
   numbers that were the same for every business and moved for nobody.
   That is fine for the anonymous demo, whose job is to show what the
   product would look like, and wrong for a signed-in owner, for whom
   "18 hours saved" is either true or a lie.

   So: real figures when signed in, illustrations otherwise, and an
   honest zero rather than a borrowed number in between.

   That "in between" is why this has three states rather than two. A
   boolean has to answer "is this real?" with `false` while the
   request is still in flight, and every caller read `false` as "show
   the demo" — so a signed-in owner got someone else's dashboard for
   as long as the fetch took: 82% handled, twelve conversations, an
   approval waiting. Then the real answer arrived, the approval row
   vanished, and the page jumped. `pending` is the missing third
   answer, and it renders the real layout with nothing in it.

   One fetch, shared. Dashboard and Home each called this hook, which
   meant two requests for the same data and two independent moments of
   flipping — the sidebar could settle while the cards were still
   showing the demo.
   ============================================================ */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRepository } from '@/lib/repo';
import type { Activity } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';

/**
 * - `real`    — these are this business's own figures.
 * - `pending` — signed in, but the answer has not arrived. Render the
 *   real layout empty; never the demo.
 * - `error`   — the server answered with a failure; offer a retry.
 * - `demo`    — nobody is signed in, so the illustration is the point.
 */
export type ActivityMode = 'real' | 'pending' | 'error' | 'demo';

export interface ActivityState {
  /** Null while loading, failed, or when this session has no server to ask. */
  data: Activity | null;
  loading: boolean;
  error: Error | null;
  mode: ActivityMode;
  /** True when these are real figures for this business. */
  real: boolean;
  reload: () => void;
}

function useActivityFetch(enabled: boolean): ActivityState {
  const repo = useRepository();
  const signedIn = useSignedIn() && enabled;
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  /* Guards the React 18 double-invoke in development, which would
     otherwise fire two identical requests on every mount. */
  const inflight = useRef(false);

  useEffect(() => {
    if (!signedIn) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    let cancelled = false;

    void repo
      .activity()
      .then((a) => {
        if (cancelled) return;
        setData(a);
        setError(null);
        setLoading(false);
        inflight.current = false;
      }, (reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason : new Error('Could not load activity.'));
        setLoading(false);
        inflight.current = false;
      });

    return () => {
      cancelled = true;
      inflight.current = false;
    };
  }, [repo, signedIn, nonce]);

  const mode: ActivityMode = !signedIn
    ? 'demo'
    : data !== null
      ? 'real'
      : error
        ? 'error'
        : 'pending';

  return {
    data,
    loading,
    error,
    mode,
    real: mode === 'real',
    reload: () => {
      setData(null);
      setError(null);
      setLoading(true);
      setNonce((n) => n + 1);
    },
  };
}

const Ctx = createContext<ActivityState | null>(null);

/**
 * One fetch for everything below it. Without this, each consumer ran
 * its own request and settled at its own moment.
 */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const state = useActivityFetch(true);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/**
 * Shares the provider's fetch when there is one. Standing alone — in a
 * test, or a screen mounted outside the dashboard — it fetches for
 * itself rather than throwing, because a missing provider should cost
 * a duplicate request and not a blank screen.
 */
export function useActivity(): ActivityState {
  const shared = useContext(Ctx);
  /* Hooks cannot be conditional, so the fallback always runs — but it
     only fetches when there is no provider to borrow from. Calling it
     unconditionally is what made two requests in the first place. */
  const own = useActivityFetch(shared === null);
  return shared ?? own;
}
