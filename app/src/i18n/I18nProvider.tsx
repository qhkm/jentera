/* ============================================================
   i18n. English by default, BM on request.

   The engine defaulted from the country's locale, which meant
   Malaysia opened in BM. English-first is the intent (the engine's
   own comment said so; its code disagreed), so the country locale
   no longer seeds the default — only an explicit choice does.

   The old engine swept the DOM for [data-t] on every toggle.
   Here `t` comes from context, so a language change re-renders
   through React and static markup needs no attribute hooks.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { MESSAGES as PORTED } from '@/lib/data/i18n';
import { PAGE_MESSAGES } from './pages';
import type { Lang } from '@/lib/types';

import { useMutate, useSnapshot } from '@/lib/repo';

/** Ported engine strings, with the React app's page copy layered on top. */
const MESSAGES: Record<Lang, Record<string, string>> = {
  en: { ...PORTED.en, ...PAGE_MESSAGES.en },
  bm: { ...PORTED.bm, ...PAGE_MESSAGES.bm },
};

const TITLES: Record<Lang, string> = {
  en: 'Jentera — Your business, without the busywork',
  bm: 'Jentera — Perniagaan anda, tanpa kerja remeh',
};

export const DEFAULT_LANG: Lang = 'en';

/** Named-slot interpolation: t('su.count', { done: 2, total: 5 }). */
export type Vars = Record<string, string | number>;

interface I18nValue {
  lang: Lang;
  t: (key: string, vars?: Vars) => string;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { lang } = useSnapshot();
  const mutate = useMutate();

  useEffect(() => {
    document.title = TITLES[lang];
    document.documentElement.lang = lang === 'bm' ? 'ms' : 'en';
  }, [lang]);

  const setLang = useCallback(
    (next: Lang) => void mutate((r) => r.setLang(next)),
    [mutate],
  );

  const toggleLang = useCallback(
    () => void mutate((r) => r.setLang(lang === 'en' ? 'bm' : 'en')),
    [mutate, lang],
  );

  /** Falls back through the active language, then English, then the key. */
  const t = useCallback(
    (key: string, vars?: Vars) =>
      interpolate(MESSAGES[lang]?.[key] ?? MESSAGES.en?.[key] ?? key, vars),
    [lang],
  );

  const value = useMemo(
    () => ({ lang, t, setLang, toggleLang }),
    [lang, t, setLang, toggleLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Convenience for the common case. */
export function useT(): (key: string, vars?: Vars) => string {
  return useI18n().t;
}
