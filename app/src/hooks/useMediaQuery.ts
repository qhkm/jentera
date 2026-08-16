/* ============================================================
   Media query as state.

   Only for things CSS genuinely cannot do — swapping placeholder
   text, for instance. Layout should stay in CSS, where it works
   before hydration and cannot disagree with the stylesheet.
   ============================================================ */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Below Tailwind's `sm` breakpoint. */
export function useIsCompact(): boolean {
  return !useMediaQuery('(min-width: 40rem)');
}
