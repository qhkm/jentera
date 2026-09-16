import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  BellRinging,
  CaretDown,
  DeviceMobile,
  Moon,
  SignOut,
  SlidersHorizontal,
  Sun,
  Translate,
  Trash,
  User,
} from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/hooks/useTheme';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import { useAccountEmail, useRoutinesEnabled, useSignedIn } from '@/lib/repo/gate';
import { useToast } from '@/components/Toast';
import { usePwaInstall } from '@/pwa/install';
import { usePushNotifications } from '@/pwa/push';
import { useRepository } from '@/lib/repo';
import type { AccountDeletionRequested } from '@/lib/repo/types';
import { knownRoutine } from '@/lib/routines/types';
import DeleteAccount from '@/components/DeleteAccount';

export function AccountMenu({
  onSignOut,
  leaving = false,
  mobileActions,
}: {
  onSignOut: () => void;
  leaving?: boolean;
  mobileActions?: ReactNode;
}) {
  const { lang, t, toggleLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const detail = useDetailLevel();
  const signedIn = useSignedIn();
  const email = useAccountEmail();
  const repo = useRepository();
  const routinesEnabled = useRoutinesEnabled() && !!repo.routines;
  const toast = useToast();
  const install = usePwaInstall();
  const push = usePushNotifications();
  const [open, setOpen] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /* null is "could not be checked", which DeleteAccount says out loud. */
  const [routineCount, setRoutineCount] = useState<number | null>(0);
  const [deleted, setDeleted] = useState<AccountDeletionRequested | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    if (!deleted) {
      const items = menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      );
      (focusLast.current ? items?.[items.length - 1] : items?.[0])?.focus();
    }
    const onPointerDown = (event: PointerEvent) => {
      /* Once the deletion is confirmed this panel is the only place those
         facts appear, and the session behind it is already dead. A stray
         click outside must not take it away unread. */
      if (deleted) return;
      if (event.target instanceof Node && !container.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, deleted]);

  // The delete-account card only ever shows inside this popover; closing
  // the popover for any other reason (Escape, a click outside, signing
  // out) should not leave it primed to reopen straight into that card.
  useEffect(() => {
    if (!open) {
      setDeleteOpen(false);
      setDeleted(null);
    }
  }, [open]);

  /* Counted only when the owner actually opens the card — not on every
     visit to the menu — since it is the one thing here that costs a
     request. A failed count says so: omitting the line reads as "you have
     none", which is a different statement and one this screen is not
     entitled to make. The authoritative number arrives with the response
     and is what the confirmation below shows. */
  useEffect(() => {
    if (!deleteOpen || !routinesEnabled || !repo.routines) return;
    let cancelled = false;
    repo.routines.list().then((list) => {
      if (!cancelled) setRoutineCount(list.routines.filter(knownRoutine).length);
    }).catch(() => {
      if (!cancelled) setRoutineCount(null);
    });
    return () => {
      cancelled = true;
    };
  }, [deleteOpen, routinesEnabled, repo]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(action: () => void) {
    action();
    close();
  }

  /* Chromium shows its own sheet; Safari on iPhone has no prompt to show,
     so the owner is told where Add to Home Screen lives instead. */
  async function togglePush() {
    setPushNotice(null);
    if (push.state === 'on') {
      await push.disable();
      toast(t('pwa.push.disabled'), 'neutral');
      return;
    }
    const outcome = await push.enable();
    if (outcome === 'on') toast(t('pwa.push.enabled'));
    else if (outcome !== 'busy') {
      const key = outcome === 'denied' ? 'pwa.push.deniedHint' : `pwa.push.${outcome}`;
      setPushNotice(key);
      toast(t(key), 'neutral');
    }
  }

  function installApp() {
    if (install.canPrompt) {
      void install.promptInstall().then((outcome) => {
        if (outcome === 'accepted') toast(t('pwa.installed'));
      });
      return;
    }
    toast(t('pwa.ios.hint'), 'neutral');
  }

  /* The route already ended this session; there is nothing left to clean
     up here beyond leaving for a page that does not assume one. Same hard
     navigation Sign out uses, for the same reason — the app boots fresh
     rather than carrying stale signed-in state into a dead session. */
  /* Not a navigation. The response carries the only facts the person has
     about what just happened — seven days, signed out everywhere, how many
     scheduled jobs stop, and whether the cancel link actually reached
     their inbox. Leaving the page on success threw all four away. */
  async function deleteAccount(typedEmail: string) {
    const result = await repo.requestAccountDeletion(typedEmail);
    setDeleted(result);
    return result;
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      if (mobileActions && !event.shiftKey && window.matchMedia('(max-width: 767px)').matches)
        return;
      // Continue the page's normal tab order from the avatar.
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(
        menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
      );
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  }

  return (
    <div
      ref={container}
      className="account-menu"
      onBlur={(event) => {
        if (deleted) return;
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        className="account-menu-trigger"
        aria-label={t(signedIn ? 'account.menu' : 'account.preferences')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          focusLast.current = false;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            focusLast.current = event.key === 'ArrowUp';
            setOpen(true);
          }
        }}
      >
        <span className="account-avatar">
          <User size={21} weight="duotone" aria-hidden="true" />
        </span>
        <CaretDown size={12} className="account-menu-caret" aria-hidden="true" />
      </button>
      {open ? (
        <div className="account-menu-popover">
          <div className="account-menu-heading">
            <span>Jentera</span>
            <strong>{t(signedIn ? 'account.title' : 'account.preferences')}</strong>
          </div>
          {deleted ? (
            <div className="account-menu-delete-panel">
              <section className="card px-4 py-3" role="status" aria-label="Account scheduled for deletion">
                <strong className="block">Your account is scheduled for deletion.</strong>
                <ul className="mt-2 list-disc pl-5 text-text-secondary">
                  <li>You are signed out on every device.</li>
                  <li>
                    Everything is erased in {deleted.graceDays} days. Until then, nothing is.
                  </li>
                  {deleted.routines > 0 ? (
                    <li>
                      {deleted.routines} scheduled {deleted.routines === 1 ? 'job' : 'jobs'} you set
                      up will stop.
                    </li>
                  ) : null}
                  {deleted.noticeSent ? (
                    <li>
                      A link to cancel is in your inbox at {email}. It works once, until the{' '}
                      {deleted.graceDays} days are up.
                    </li>
                  ) : (
                    <li>
                      We could not email the cancel link to {email}. If you change your mind, write
                      to hello@kitakodventures.com before the {deleted.graceDays} days are up.
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  className="btn btn-outline mt-3"
                  onClick={() => {
                    window.location.href = '/';
                  }}
                >
                  Done
                </button>
              </section>
            </div>
          ) : deleteOpen && email ? (
            <div
              className="account-menu-delete-panel"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !leaving) {
                  event.stopPropagation();
                  setDeleteOpen(false);
                }
              }}
            >
              <DeleteAccount
                email={email}
                routines={routineCount}
                onDelete={deleteAccount}
                startOpen
                onCancel={() => setDeleteOpen(false)}
              />
            </div>
          ) : (
            <div
              ref={menu}
              id={`${id}-menu`}
              role="menu"
              aria-labelledby={`${id}-trigger`}
              onKeyDown={handleKey}
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="account-menu-item"
                aria-label={t(theme === 'dark' ? 'db.theme.toLight' : 'db.theme.toDark')}
                onClick={() => choose(toggleTheme)}
              >
                {theme === 'dark' ? (
                  <Moon size={18} weight="duotone" aria-hidden="true" />
                ) : (
                  <Sun size={18} weight="duotone" aria-hidden="true" />
                )}
                <span>{t('account.appearance')}</span>
                <span className="account-menu-value">
                  {t(theme === 'dark' ? 'db.dark' : 'db.light')}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="account-menu-item"
                aria-label={t(lang === 'en' ? 'account.language.bm' : 'account.language.en')}
                onClick={() => choose(toggleLang)}
              >
                <Translate size={18} weight="duotone" aria-hidden="true" />
                <span>{t('nav.language')}</span>
                <span className="account-menu-value">{lang === 'en' ? 'English' : 'BM'}</span>
              </button>
              {detail.canChange ? (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="account-menu-item"
                  onClick={() => choose(() => detail.set(detail.advanced ? 'beginner' : 'advanced'))}
                >
                  <SlidersHorizontal size={18} weight="duotone" aria-hidden="true" />
                  <span>{t('nav.detail')}</span>
                  <span className="account-menu-value">
                    {t(detail.advanced ? 'account.advanced' : 'account.simple')}
                  </span>
                </button>
              ) : null}
              {signedIn && push.state !== 'unsupported' ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="account-menu-item"
                    disabled={push.busy || push.state === 'checking'}
                    aria-busy={push.busy || push.state === 'checking' || undefined}
                    aria-describedby={pushNotice ? `${id}-push-notice` : undefined}
                    onClick={() => choose(() => void togglePush())}
                  >
                    <BellRinging size={18} weight="duotone" aria-hidden="true" />
                    <span>{t('pwa.push')}</span>
                    <span className="account-menu-value">
                      {t(push.busy ? 'pwa.push.enabling' : push.state === 'checking' ? 'pwa.push.checking' : push.state === 'unknown' ? 'pwa.push.unknown' : push.state === 'on' ? 'pwa.push.on' : push.state === 'denied' ? 'pwa.push.blocked' : 'pwa.push.off')}
                    </span>
                  </button>
                  {pushNotice ? <p id={`${id}-push-notice`} className="px-3 py-2 text-xs text-text-muted">{t(pushNotice)}</p> : null}
                </>
              ) : null}
              {signedIn && (install.canPrompt || install.iosHint) ? (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="account-menu-item"
                  onClick={() => choose(installApp)}
                >
                  <DeviceMobile size={18} weight="duotone" aria-hidden="true" />
                  <span>{t('pwa.install')}</span>
                </button>
              ) : null}
              {signedIn ? (
                <>
                  <div className="account-menu-divider" role="separator" />
                  {email ? (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className="account-menu-item account-menu-delete"
                      onClick={() => {
                        focusLast.current = false;
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash size={18} weight="duotone" aria-hidden="true" />
                      <span>{t('account.delete')}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="account-menu-item account-menu-signout"
                    disabled={leaving}
                    onClick={onSignOut}
                  >
                    <SignOut size={18} weight="duotone" aria-hidden="true" />
                    <span>{t(leaving ? 'account.leaving' : 'nav.logout')}</span>
                  </button>
                </>
              ) : null}
            </div>
          )}
          {!deleted && !(deleteOpen && email) && mobileActions ? (
            <div
              className="account-menu-actions md:hidden"
              onKeyDown={(event) => {
                if (event.key === 'Escape') close();
              }}
            >
              {mobileActions}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
