/* ============================================================
   Real work records and counters, when there is a server to ask.

   Home and Activity used to render playbook illustrations — plausible
   numbers that were the same for every business and moved for nobody.
   That is fine for the anonymous demo, whose job is to show what the
   product would look like, and wrong for a signed-in owner, for whom
   "18 hours saved" is either true or a lie.

   So: real figures when signed in, illustrations otherwise, and an
   honest zero rather than a borrowed number in between.
   ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { useRepository } from '@/lib/repo';
import type { Activity } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';

export interface ActivityState {
  /** Null while loading, or when this session has no server to ask. */
  data: Activity | null;
  loading: boolean;
  /** True when these are real figures for this business. */
  real: boolean;
  reload: () => void;
}

export function useActivity(): ActivityState {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [nonce, setNonce] = useState(0);
  /* Guards the React 18 double-invoke in development, which would
     otherwise fire two identical requests on every mount. */
  const inflight = useRef(false);

  useEffect(() => {
    if (!signedIn) {
      setData(null);
      setLoading(false);
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    let cancelled = false;

    void repo
      .activity()
      .then(
        (a) => a,
        /* A failure here must not blank the dashboard. Falling back to
           the illustrations is wrong — they would read as real — so the
           screens treat null as "no figures" and say so. */
        () => null,
      )
      .then((a) => {
        if (cancelled) return;
        setData(a);
        setLoading(false);
        inflight.current = false;
      });

    return () => {
      cancelled = true;
      inflight.current = false;
    };
  }, [repo, signedIn, nonce]);

  return {
    data,
    loading,
    real: signedIn && data !== null,
    reload: () => setNonce((n) => n + 1),
  };
}
