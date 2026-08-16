/* ============================================================
   i18n. English-first with BM support; the active country's
   language seeds the default, and an explicit choice wins.

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
  useState,
  type ReactNode,
} from 'react';
import { MESSAGES as PORTED } from '@/lib/data/i18n';
import { PAGE_MESSAGES } from './pages';
import type { Lang } from '@/lib/types';

/** Ported engine strings, with the React app's page copy layered on top. */
const MESSAGES: Record<Lang, Record<string, string>> = {
  en: { ...PORTED.en, ...PAGE_MESSAGES.en },
  bm: { ...PORTED.bm, ...PAGE_MESSAGES.bm },
};
import { getCountry } from '@/lib/country';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';

const TITLES: Record<Lang, string> = {
  en: 'AISAR Platform — Your business, increasingly run by AI',
  bm: 'AISAR Platform — Perniagaan anda, semakin dikendalikan AI',
};

function isTranslated(code: string): code is Lang {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code);
}

function initialLang(): Lang {
  const stored = store.get(KEYS.lang, '');
  if (isTranslated(stored)) return stored;
  // A country's preferred locale may not be translated yet (id/th/vi/fil).
  const preferred = getCountry().lang;
  return isTranslated(preferred) ? preferred : 'en';
}

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
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.title = TITLES[lang];
    document.documentElement.lang = lang === 'bm' ? 'ms' : 'en';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    store.set(KEYS.lang, next);
    setLangState(next);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === 'en' ? 'bm' : 'en';
      store.set(KEYS.lang, next);
      return next;
    });
  }, []);

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
