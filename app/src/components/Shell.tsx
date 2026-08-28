/* ============================================================
   Page chrome. In the static site the header, drawer and toast
   were copy-pasted across four HTML files; here they are one
   component, which is most of why the React port shrinks.
   ============================================================ */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useI18n } from '@/i18n/I18nProvider';
import { Button } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { useSignedIn } from '@/lib/repo/gate';
import { useDetailLevel } from '@/hooks/useDetailLevel';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link to="/" aria-label="Jentera home" className="inline-flex items-center gap-2">
      <span className="font-pixel text-xl tracking-wide text-brand md:text-2xl">Jentera</span>
      {suffix ? (
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted md:inline">
          {suffix}
        </span>
      ) : null}
    </Link>
  );
}

export function Shell({
  suffix,
  actions,
  onMenu,
  menuBadge = 0,
  fullBleed = false,
  children,
}: {
  suffix?: string;
  actions?: ReactNode;
  /** Supplied by the dashboard to open the mobile drawer. */
  onMenu?: () => void;
  menuBadge?: number;
  /**
   * Drop the main padding on mobile so a view can run edge-to-edge and
   * own its own height — used by the chat, which should fill the screen
   * rather than sit as a card inside a padded page.
   */
  fullBleed?: boolean;
  children: ReactNode;
}) {
  const { lang, t, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const signedIn = useSignedIn();
  const detail = useDetailLevel();
  const [leaving, setLeaving] = useState(false);
  const [utilityOpen, setUtilityOpen] = useState(false);

  useEffect(() => {
    if (!utilityOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUtilityOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [utilityOpen]);

  async function signOut() {
    setLeaving(true);
    try {
      /* Ask the server to destroy the session row before dropping the
         cookie. Clearing the cookie alone would leave a live session
         behind — usable by anyone who captured it, and still counted
         as active on the account. */
      await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      /* Offline, or the API is unreachable. Fall through to the reload
         anyway: the cookie may survive, but stranding someone on a
         dashboard with a dead Log out button is worse. */
    }
    /* Hard navigation, not a route change. RepositoryGate picks local
       or remote once at startup, so the app has to boot again to drop
       back to the anonymous demo. */
    window.location.href = '/';
  }

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="relative sticky top-0 z-30 border-b border-rail bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1250px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {onMenu ? (
              <button
                type="button"
                onClick={() => {
                  setUtilityOpen(false);
                  onMenu();
                }}
                className="relative -ml-1 flex size-8 flex-col items-center justify-center gap-[5px] lg:hidden"
                aria-label={t('drawer.menu')}
              >
                <span className="block h-[1.5px] w-5 bg-text" />
                <span className="block h-[1.5px] w-5 bg-text" />
                <span className="block h-[1.5px] w-5 bg-text" />
                {menuBadge > 0 ? (
                  <span className="absolute -right-1 -top-1 size-2 rounded-full bg-brand" />
                ) : null}
              </button>
            ) : null}
            <Logo suffix={suffix} />
          </div>

          <div className="hidden items-center gap-2 md:flex">
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
              aria-label={t('nav.language')}
            >
              {lang === 'en' ? 'BM' : 'EN'}
            </button>
            {/* Only when signed in: the demo has no trace to reveal, so
                the control would promise something it cannot give. */}
            {detail.canChange ? (
              <button
                type="button"
                onClick={() => detail.set(detail.advanced ? 'beginner' : 'advanced')}
                className="nav-link px-2 py-1"
                aria-pressed={detail.advanced}
                title={
                  detail.advanced
                    ? 'Showing the technical trace'
                    : 'Show the technical trace and raw operation names'
                }
              >
                {detail.advanced ? 'SIMPLE' : 'DETAIL'}
              </button>
            ) : null}
            {/* Only for a server-backed session. The anonymous demo has
                nothing to log out of, and offering it there would imply
                an account the visitor does not have. */}
            {signedIn ? (
              <button
                type="button"
                onClick={signOut}
                className="nav-link px-2 py-1"
                disabled={leaving}
              >
                {t('nav.logout')}
              </button>
            ) : null}
            {actions}
          </div>

          <button
            type="button"
            onClick={() => setUtilityOpen((open) => !open)}
            className="flex size-10 items-center justify-center rounded-item border border-rail text-lg leading-none md:hidden"
            aria-label={t('nav.more')}
            aria-expanded={utilityOpen}
            aria-controls="mobile-utility-menu"
          >
            <span aria-hidden="true" className="-mt-1 tracking-[0.12em]">•••</span>
          </button>
        </div>

        {utilityOpen ? (
          <div
            id="mobile-utility-menu"
            className="absolute right-4 top-[calc(100%+0.5rem)] z-40 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-1 rounded-card border border-border bg-bg p-2 shadow-xl md:hidden"
          >
            <button
              type="button"
              onClick={() => {
                toggleTheme();
                setUtilityOpen(false);
              }}
              className="nav-link flex w-full items-center justify-between rounded-item px-3 py-2.5 text-left"
            >
              <span>{t(theme === 'dark' ? 'db.theme.toLight' : 'db.theme.toDark')}</span>
              <span className="text-text-muted">{t(theme === 'dark' ? 'db.light' : 'db.dark')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                toggleLang();
                setUtilityOpen(false);
              }}
              className="nav-link flex w-full items-center justify-between rounded-item px-3 py-2.5 text-left"
            >
              <span>{t('nav.language')}</span>
              <span className="text-text-muted">{lang === 'en' ? 'BM' : 'EN'}</span>
            </button>
            {detail.canChange ? (
              <button
                type="button"
                onClick={() => {
                  detail.set(detail.advanced ? 'beginner' : 'advanced');
                  setUtilityOpen(false);
                }}
                className="nav-link flex w-full items-center justify-between rounded-item px-3 py-2.5 text-left"
                aria-pressed={detail.advanced}
              >
                <span>{t('nav.detail')}</span>
                <span className="text-text-muted">{detail.advanced ? 'SIMPLE' : 'DETAIL'}</span>
              </button>
            ) : null}
            {signedIn ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className="nav-link w-full rounded-item px-3 py-2.5 text-left"
                disabled={leaving}
              >
                {t('nav.logout')}
              </button>
            ) : null}
            {actions ? <div className="p-1">{actions}</div> : null}
          </div>
        ) : null}
      </header>
      <main
        className={
          fullBleed
            ? 'mx-auto max-w-[1250px] px-0 py-0 lg:px-6 lg:py-10'
            : 'mx-auto max-w-[1250px] px-6 py-10'
        }
      >
        {children}
      </main>
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
