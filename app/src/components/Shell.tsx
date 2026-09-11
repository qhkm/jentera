/* ============================================================
   Page chrome. In the static site the header, drawer and toast
   were copy-pasted across four HTML files; here they are one
   component, which is most of why the React port shrinks.
   ============================================================ */

import { useState } from 'react';
import { clearAskStorage } from '@/hooks/useAsk';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useI18n } from '@/i18n/I18nProvider';
import { Button } from '@/components/ui';
import { JenteraMark } from '@/components/JenteraMark';
import { AccountMenu } from '@/components/AccountMenu';
import { PwaUpdateNotice } from '@/components/PwaUpdateNotice';
import { InstallNudge } from '@/components/InstallNudge';
import { disablePush } from '@/pwa/push';
import { useRepository } from '@/lib/repo';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link to="/" aria-label="Jentera home" className="inline-flex items-center gap-2">
      <JenteraMark size={32} />
      <span className="jentera-wordmark font-pixel text-xl tracking-wide text-brand md:text-2xl">Jentera</span>
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
  navigation,
  onMenu,
  menuBadge = 0,
  fullBleed = false,
  className = '',
  children,
}: {
  suffix?: string;
  actions?: ReactNode;
  /** Workspace-level navigation, separate from page actions and account settings. */
  navigation?: ReactNode;
  /** Supplied by the dashboard to open the mobile drawer. */
  onMenu?: () => void;
  menuBadge?: number;
  /**
   * Drop the main padding on mobile so a view can run edge-to-edge and
   * own its own height — used by the chat, which should fill the screen
   * rather than sit as a card inside a padded page.
   */
  fullBleed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false);
  const repo = useRepository();

  async function signOut() {
    setLeaving(true);
    clearAskStorage();
    /* This browser must stop receiving this owner's notifications before
       the session goes; the endpoint is the browser's, not the account's. */
    await disablePush(repo);
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
    <div className={`min-h-dvh bg-bg text-text ${className}`}>
      <header className="relative sticky top-0 z-30 border-b border-rail bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1250px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {onMenu ? (
              <button
                type="button"
                onClick={onMenu}
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

          {navigation ? <div className="shell-mode-navigation">{navigation}</div> : null}

          <div className="flex items-center gap-3">
            {actions ? <div className="hidden items-center gap-2 md:flex">{actions}</div> : null}
            <AccountMenu
              onSignOut={() => void signOut()}
              leaving={leaving}
              mobileActions={actions}
            />
          </div>
        </div>
      </header>
      <InstallNudge />
      <main
        className={
          fullBleed
            ? 'mx-auto max-w-[1250px] px-0 py-0 lg:px-6 lg:py-10'
            : 'mx-auto max-w-[1250px] px-6 py-10'
        }
      >
        {children}
      </main>
      <PwaUpdateNotice />
    </div>
  );
}

export function PageActions() {
  const { t } = useI18n();
  return (
    <Link to="/signin?mode=signup">
      <Button className="px-5 py-2 text-sm">{t('nav.getstarted')}</Button>
    </Link>
  );
}
