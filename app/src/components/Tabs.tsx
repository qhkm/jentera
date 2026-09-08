/* ============================================================
   Tab strip.

   Extracted from Ask Jentera so My Business gets the same control
   rather than a second, subtly different one. Labels never wrap
   and the row scrolls horizontally when it runs out of room —
   both learned from fixing this at 390px the first time.
   ============================================================ */

import type { ReactNode } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  /** Optional trailing element, e.g. a count or status tag. */
  trailing?: ReactNode;
  /** Hide the trailing element on narrow screens. */
  trailingCompact?: boolean;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  label,
  className = '',
  idPrefix,
}: {
  tabs: TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
  label: string;
  className?: string;
  idPrefix?: string;
}) {
  return (
    <div
      className={`flex shrink-0 gap-1 overflow-x-auto border-b border-rail [scrollbar-width:none] ${className}`}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            aria-controls={idPrefix && on ? `${idPrefix}-panel-${tab.id}` : undefined}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              const index = tabs.findIndex((item) => item.id === tab.id);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index - 1 + tabs.length) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              onSelect(tabs[next].id);
              const target =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                )[next];
              target?.focus();
              target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
            }}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors sm:px-4 ${
              on
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.trailing ? (
              <span className={tab.trailingCompact ? 'ml-2 hidden sm:inline-flex' : 'ml-2'}>
                {tab.trailing}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
