/* ============================================================
   Keyboard-aware viewport.

   On iOS the software keyboard does not shrink the layout viewport,
   so `100dvh` keeps reporting the full screen height and the
   composer ends up underneath the keyboard. visualViewport is the
   only thing that reports the actually-visible area.

   Publishes two things for CSS to use:
     --vvh          the visible viewport height
     .kb-open       set while the keyboard is up
   ============================================================ */

import { useEffect, useState } from 'react';

/** Below this the shrink is browser chrome, not a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;

export function useVisualViewport(enabled = true): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setKeyboardOpen(false);
      return;
    }
    const vv = window.visualViewport;
    const root = document.documentElement;

    if (!vv) {
      // No support: fall back to the CSS default (100dvh) and never
      // claim the keyboard is open.
      root.style.removeProperty('--vvh');
      return;
    }

    const apply = () => {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      const keyboardUp = window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX;
      root.classList.toggle('kb-open', keyboardUp);
      setKeyboardOpen(keyboardUp);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);

    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--vvh');
      root.classList.remove('kb-open');
    };
  }, [enabled]);

  return keyboardOpen;
}
