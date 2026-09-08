import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  CaretDown,
  Moon,
  SignOut,
  SlidersHorizontal,
  Sun,
  Translate,
  User,
} from '@phosphor-icons/react';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/hooks/useTheme';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import { useSignedIn } from '@/lib/repo/gate';

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
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    (focusLast.current ? items?.[items.length - 1] : items?.[0])?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function choose(action: () => void) {
    action();
    close();
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
            {signedIn ? (
              <>
                <div className="account-menu-divider" role="separator" />
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
          {mobileActions ? (
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
