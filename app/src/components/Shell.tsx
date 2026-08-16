/* ============================================================
   Page chrome. In the static site the header, drawer and toast
   were copy-pasted across four HTML files; here they are one
   component, which is most of why the React port shrinks.
   ============================================================ */

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useI18n } from '@/i18n/I18nProvider';
import { Button } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link to="/" aria-label="AISAR home" className="inline-flex items-center gap-2">
      <span className="font-pixel text-xl tracking-wide text-brand md:text-2xl">aisar</span>
      {suffix ? (
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted sm:inline">
          {suffix}
        </span>
      ) : null}
    </Link>
  );
}

export function Shell({
  suffix,
  actions,
  children,
}: {
  suffix?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { lang, t, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="sticky top-0 z-50 border-b border-rail bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1250px] items-center justify-between gap-4 px-6">
          <Logo suffix={suffix} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="nav-link px-2 py-1"
              aria-label={t(theme === 'dark' ? 'db.theme.toLight' : 'db.theme.toDark')}
            >
              {t(theme === 'dark' ? 'db.light' : 'db.dark')}
            </button>
            <button
              type="button"
              onClick={toggleLang}
              className="nav-link px-2 py-1"
              aria-label="Toggle language"
            >
              {lang === 'en' ? 'BM' : 'EN'}
            </button>
            {actions}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1250px] px-6 py-10">{children}</main>
    </div>
  );
}

export function PageActions() {
  const { t } = useI18n();
  return (
    <Link to="/onboard">
      <Button className="px-5 py-2 text-sm">{t('nav.getstarted')}</Button>
    </Link>
  );
}
