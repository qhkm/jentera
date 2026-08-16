/* ============================================================
   Theme. The whole flip is one class on <html> — every token
   downstream re-resolves, including --border-ink, which is what
   re-themes every border in the product.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import * as store from '@/lib/storage';

const KEY = 'aisar-theme';
export type Theme = 'dark' | 'light';

function initial(): Theme {
  const v = store.get(KEY, '');
  return v === 'light' ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    store.set(KEY, next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      store.set(KEY, next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
