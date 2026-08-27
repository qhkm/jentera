/* ============================================================
   Dashboard shell — four areas, deliberately not eight.

   Agent rosters, connections and approvals were separate views
   and read as competing technical products. They are now facts
   inside My Business, or work records inside Activity.

     Home        what happened, what needs you, what's next
     Ask AISAR   ask or instruct (+ Customer inbox tab)
     Activity    completed, active, and approval-blocked work
     My Business knowledge, responsibilities, connections
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Avatar, Card, Eyebrow, Progress, Tag } from '@/components/ui';
import { useBusiness } from '@/hooks/useBusiness';
import { useActivity } from '@/hooks/useActivity';
import { useSnapshot } from '@/lib/repo';
import { milestones, readiness } from '@/lib/business';
import { useT } from '@/i18n/I18nProvider';
import { Icon, type IconName } from '@/components/Icon';
import { useIsCompact } from '@/hooks/useMediaQuery';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import HomeView from './views/HomeView';
import AskAisarView from './views/AskAisarView';
import ActivityView from './views/ActivityView';
import MyBusinessView from './views/MyBusinessView';

export type View = 'home' | 'chat' | 'work' | 'business';

interface NavItem {
  id: View;
  labelKey: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: 'home' },
  { id: 'chat', labelKey: 'nav.chat', icon: 'chat' },
  { id: 'work', labelKey: 'nav.work', icon: 'activity' },
  { id: 'business', labelKey: 'nav.business', icon: 'business' },
];

export default function Dashboard() {
  const t = useT();
  const [view, setView] = useState<View>('home');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const b = useBusiness();
  const { business } = b;

  /** Anything blocked on the owner, from either source. */
  /* Real approvals when there is a server, the playbook's illustration
     otherwise. Mixing them put an amber "1" on the Activity tab of an
     account whose own dashboard said nothing was waiting — and reading
     `pending` as "otherwise" put that same "1" there for the length of
     the fetch, on every load. */
  const activity = useActivity();
  const snap = useSnapshot();
  const demo = activity.mode === 'demo';
  const needsAttention = activity.real
    ? activity.data!.counters.needsYou
    : demo
      ? b.needsYouCount + b.approvals.length
      : 0;

  /* While the software keyboard is up in the chat, the bottom bar would
     sit between the composer and the keyboard. Hide it for the duration. */
  const compact = useIsCompact();
  const keyboardOpen = useVisualViewport(compact && view === 'chat');

  const playbookHandled = useMemo(
    () => business.work.filter((w, i) => w.tag !== 'needs you' || b.workDone(i)).length,
    [business.work, b],
  );
  const handled = activity.real ? activity.data!.counters.handled : demo ? playbookHandled : 0;

  /* Milestones, not a projection: knows something, can reach someone,
     has done something. All three are checkable and all three move. */
  const done = activity.real ? activity.data!.counters.handled : 0;
  const linked = activity.real ? activity.data!.counters.connections : 0;
  const ready = readiness(snap, done, linked);
  const nextStep = milestones(snap, done, linked).find((m) => !m.done);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function go(next: View) {
    setView(next);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navButton(item: NavItem) {
    const active = view === item.id;
    const badge = item.id === 'work' ? needsAttention : 0;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => go(item.id)}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center justify-between gap-2 rounded-item px-3.5 py-2.5 text-[13px] transition-colors ${
          active
            ? 'bg-brand-soft text-brand'
            : 'text-text-secondary hover:bg-[rgb(var(--border-ink)/0.05)] hover:text-text'
        }`}
      >
        <span className="flex items-center gap-2.5">
          <Icon name={item.icon} size={17} />
          {t(item.labelKey)}
        </span>
        {badge > 0 ? <Tag tone="amber">{badge}</Tag> : null}
      </button>
    );
  }

  const profile = (
    <Card className="gap-2">
      <div className="flex items-center gap-3">
        <Avatar emoji={business.icon} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{business.name}</span>
          <span className="truncate text-[11px] text-text-muted">{business.loc}</span>
        </div>
      </div>
      {/* Real progress for a real business; the playbook's projection
          for the demo. "AISAR can handle 82%" was the same number for
          every business of a type and moved for nobody — precise,
          prominent, and untethered to anything the owner had done. */}
      {activity.mode !== 'demo' ? (
        <div className="flex flex-col gap-2 border-t border-rail pt-3">
          <div className="flex items-center justify-between">
            <Eyebrow>{t('side.ready')}</Eyebrow>
            <span className="font-pixel text-sm tabular-nums text-brand">
              {activity.real ? `${ready}%` : '—'}
            </span>
          </div>
          <Progress value={activity.real ? ready : 0} label={t('side.ready')} />
          <span className="text-[11px] text-text-muted">
            {!activity.real ? '\u00a0' : nextStep ? t(`ms.${nextStep.key}`) : t('ms.alldone')}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-rail pt-3">
          <div className="flex items-center justify-between">
            <Eyebrow>{t('side.potential')}</Eyebrow>
            <span className="font-pixel text-sm tabular-nums text-brand">{b.potential}%</span>
          </div>
          <Progress value={b.potential} label={t('side.potential')} />
          <span className="text-[11px] text-text-muted">
            {t('pot.txt').replace('{n}', String(business.opportunities))}
          </span>
        </div>
      )}
    </Card>
  );

  return (
    <Shell
      suffix="/platform"
      onMenu={() => setDrawerOpen(true)}
      menuBadge={needsAttention}
      fullBleed={view === 'chat'}
    >
      <div
        className={`flex flex-col gap-8 lg:flex-row lg:pb-0 ${
          view === 'chat' ? 'lg:gap-8' : 'pb-24'
        }`}
      >
        <aside className="hidden shrink-0 flex-col gap-6 lg:flex lg:w-[220px]">
          {profile}
          <nav className="flex flex-col gap-1" aria-label="Dashboard sections">
            {NAV.map(navButton)}
          </nav>
        </aside>

        {drawerOpen ? (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <div
              className="fixed inset-y-0 left-0 z-50 flex w-[min(82vw,300px)] flex-col gap-5 overflow-y-auto border-r border-rail bg-bg p-5 lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label={t('drawer.menu')}
            >
              <div className="flex items-center justify-between">
                <Eyebrow>{t('drawer.menu')}</Eyebrow>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="nav-link px-2 py-1"
                  aria-label="Close menu"
                >
                  ✕
                </button>
              </div>
              {profile}
              <nav className="flex flex-col gap-1" aria-label="Dashboard sections">
                {NAV.map(navButton)}
              </nav>
            </div>
          </>
        ) : null}

        <div className="min-w-0 flex-1">
          {view === 'home' && <HomeView b={b} onNavigate={go} />}
          {view === 'chat' && (
            <AskAisarView business={business} handled={handled} needs={needsAttention} />
          )}
          {view === 'work' && <ActivityView b={b} />}
          {view === 'business' && <MyBusinessView b={b} />}
        </div>
      </div>

      {/* Four areas, so the bottom bar mirrors the sidebar exactly. */}
      <nav
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-rail bg-bg/95 backdrop-blur lg:hidden ${
          keyboardOpen ? 'hidden' : 'flex'
        }`}
        aria-label="Primary"
      >
        {NAV.map((item) => {
          const active = view === item.id;
          const badge = item.id === 'work' ? needsAttention : 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors ${
                active ? 'text-brand' : 'text-text-muted'
              }`}
            >
              <Icon name={item.icon} size={19} />
              {t(item.labelKey)}
              {badge > 0 ? (
                <span className="unread absolute right-[18%] top-1.5">{badge}</span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </Shell>
  );
}
