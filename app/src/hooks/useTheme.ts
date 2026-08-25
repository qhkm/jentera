import { useCallback, useEffect } from 'react';
import { useMutate, useSnapshot } from '@/lib/repo';
import type { Theme } from '@/lib/repo';

export type { Theme };

export function useTheme() {
  const { theme } = useSnapshot();
  const mutate = useMutate();

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => void mutate((r) => r.setTheme(next)),
    [mutate],
  );

  const toggleTheme = useCallback(
    () => void mutate((r) => r.setTheme(theme === 'dark' ? 'light' : 'dark')),
    [mutate, theme],
  );

  return { theme, setTheme, toggleTheme };
}
