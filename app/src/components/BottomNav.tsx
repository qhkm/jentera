/* ============================================================
   The phone's bottom bar. Five sections and a sixth behind a flag made it
   read as a row of tiny icons; four is what a thumb can tell apart. Home,
   Activity and Alerts stay, and everything else sits behind "More", which
   opens a sheet with the rest — badges included, so a count is never
   hidden behind the fold.
   ============================================================ */
import { useEffect, useId, useRef } from 'react';
import { DotsThreeCircle } from '@phosphor-icons/react';
import { Icon, type IconName } from '@/components/Icon';
import { useT } from '@/i18n/I18nProvider';

export interface BottomNavItem<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  badge?: number;
}

/** How many sections show as their own button; the rest go behind More. */
export const PRIMARY_SLOTS = 3;

export function BottomNav<T extends string>({ items, current, onGo, label }: {
  items: BottomNavItem<T>[];
  current: T;
  onGo: (id: T) => void;
  label: string;
}) {
  const t = useT();
  const sheet = useRef<HTMLDialogElement>(null);
  const id = useId();
  const overflow = items.length > PRIMARY_SLOTS + 1;
  const primary = overflow ? items.slice(0, PRIMARY_SLOTS) : items;
  const rest = overflow ? items.slice(PRIMARY_SLOTS) : [];
  const restActive = rest.some((item) => item.id === current);
  const restBadge = rest.reduce((sum, item) => sum + (item.badge ?? 0), 0);

  /* jsdom, and older engines, have no dialog methods; a missing one means
     the sheet simply does not open, never a crash of the whole bar. */
  const closeSheet = () => {
    const dialog = sheet.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  };
  const openSheet = () => {
    const dialog = sheet.current;
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
  };
  useEffect(() => { closeSheet(); }, [current]);

  const button = (item: BottomNavItem<T>) => {
    const active = current === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onGo(item.id)}
        aria-current={active ? 'page' : undefined}
        className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors ${active ? 'text-brand' : 'text-text-muted'}`}
      >
        <Icon name={item.icon} size={19} />
        {item.label}
        {item.badge ? <span className="unread absolute right-[18%] top-1.5">{item.badge}</span> : null}
      </button>
    );
  };

  return (
    <nav
      className="dashboard-bottom-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-rail bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      aria-label={label}
    >
      {primary.map(button)}
      {overflow && (
        <>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-controls={id}
            aria-expanded={sheet.current?.open ? 'true' : 'false'}
            aria-current={restActive ? 'page' : undefined}
            onClick={openSheet}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors ${restActive ? 'text-brand' : 'text-text-muted'}`}
          >
            <DotsThreeCircle size={19} aria-hidden="true" />
            {t('nav.more.short')}
            {restBadge > 0 ? <span className="unread absolute right-[18%] top-1.5">{restBadge}</span> : null}
          </button>
          <dialog ref={sheet} id={id} className="bottom-nav-sheet" aria-label={t('nav.more.short')} onClick={(event) => { if (event.target === event.currentTarget) closeSheet(); }}>
            <ul>
              {rest.map((item) => (
                <li key={item.id}>
                  <button type="button" aria-current={current === item.id ? 'page' : undefined} onClick={() => { closeSheet(); onGo(item.id); }}>
                    <Icon name={item.icon} size={20} />
                    <span>{item.label}</span>
                    {item.badge ? <span className="unread">{item.badge}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </dialog>
        </>
      )}
    </nav>
  );
}
