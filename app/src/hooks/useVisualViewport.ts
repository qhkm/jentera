/* ============================================================
   Keyboard-aware viewport.

   Mobile keyboards can shrink and pan the visual viewport without
   shrinking the layout viewport. Track both measurements so the fixed
   workspace stays inside the actually-visible area.

   Publishes the visible viewport, including browser panning to the caret:
     --vvh          the visible viewport height
     --vv-offset-top the visible viewport's offset in the layout viewport
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
      root.style.removeProperty('--vv-offset-top');
      return;
    }

    const apply = () => {
      // Pinch zoom also shrinks the visual viewport. Keep the layout at its
      // normal size so zoom can magnify and pan it instead of reflowing it.
      if (Math.abs(vv.scale - 1) > 0.01) return;
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vv-offset-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
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
      root.style.removeProperty('--vv-offset-top');
      root.classList.remove('kb-open');
    };
  }, [enabled]);

  return keyboardOpen;
}
