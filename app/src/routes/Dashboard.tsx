/* ============================================================
   Dashboard shell — sidebar on desktop, drawer + bottom bar on
   mobile. Views are local state, matching the static site's
   .as-view toggling.
   ============================================================ */

import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Avatar, Card, Eyebrow, Progress, Tag } from '@/components/ui';
import { useBusiness } from '@/hooks/useBusiness';
import { useT } from '@/i18n/I18nProvider';
import HomeView from './views/HomeView';
import ChatView from './views/ChatView';
import TeamChatView from './views/TeamChatView';
import BusinessView from './views/BusinessView';
import AiTeamView from './views/AiTeamView';
import WorkView from './views/WorkView';
import ConnectionsView from './views/ConnectionsView';
import ApprovalsView from './views/ApprovalsView';

export type View =
  | 'home'
  | 'chat'
  | 'team'
  | 'business'
  | 'aiteam'
  | 'work'
  | 'connections'
  | 'approvals';

interface NavItem {
  id: View;
  labelKey: string;
  icon: string;
  /** shown in the mobile bottom bar */
  primary?: boolean;
}

const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: '🏠', primary: true },
  { id: 'chat', labelKey: 'nav.chat', icon: '💬', primary: true },
  { id: 'team', labelKey: 'nav.team', icon: '👥' },
  { id: 'business', labelKey: 'nav.business', icon: '🏪' },
  { id: 'aiteam', labelKey: 'nav.aiteam', icon: '🤖', primary: true },
  { id: 'work', labelKey: 'nav.work', icon: '⚡', primary: true },
  { id: 'connections', labelKey: 'nav.connections', icon: '🔌' },
  { id: 'approvals', labelKey: 'nav.approvals', icon: '🛡️' },
];

export default function Dashboard() {
  const t = useT();
  const [view, setView] = useState<View>('home');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const b = useBusiness();
  const { business } = b;

  // Lock the page behind the drawer while it's open.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  // Escape closes the drawer.
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
    const badge = item.id === 'approvals' ? b.approvals.length : 0;
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
          <span aria-hidden="true">{item.icon}</span>
          {t(item.labelKey)}
        </span>
        {badge > 0 ? <Tag tone="amber">{badge}</Tag> : null}
      </button>
    );
  }

  const profile = (
    <Card className="gap-2">
      <div className="flex items-center gap-3">
        <Avatar>{business.icon}</Avatar>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{business.name}</span>
          <span className="truncate text-[11px] text-text-muted">{business.loc}</span>
        </div>
      </div>
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
    </Card>
  );

  return (
    <Shell
      suffix="/platform"
      onMenu={() => setDrawerOpen(true)}
      menuBadge={b.approvals.length}
    >
      <div className="flex flex-col gap-8 pb-24 lg:flex-row lg:pb-0">
        {/* ---- Desktop sidebar ---- */}
        <aside className="hidden shrink-0 flex-col gap-6 lg:flex lg:w-[220px]">
          {profile}
          <nav className="flex flex-col gap-1" aria-label="Dashboard sections">
            {NAV.map(navButton)}
          </nav>
        </aside>

        {/* ---- Mobile drawer ---- */}
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

        {/* ---- Active view ---- */}
        <div className="min-w-0 flex-1">
          {view === 'home' && <HomeView b={b} onNavigate={go} />}
          {view === 'chat' && <ChatView business={business} />}
          {view === 'team' && <TeamChatView business={business} workDone={b.workDone} />}
          {view === 'business' && (
            <BusinessView
              business={business}
              connections={b.connections}
              onChange={b.refresh}
            />
          )}
          {view === 'aiteam' && <AiTeamView b={b} onNavigate={go} />}
          {view === 'work' && (
            <WorkView business={business} workDone={b.workDone} onApprove={b.completeWork} />
          )}
          {view === 'connections' && <ConnectionsView b={b} />}
          {view === 'approvals' && <ApprovalsView b={b} />}
        </div>
      </div>

      {/* ---- Mobile bottom bar ---- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rail bg-bg/95 backdrop-blur lg:hidden"
        aria-label="Primary"
      >
        {NAV.filter((n) => n.primary).map((item) => {
          const active = view === item.id;
          const badge = item.id === 'work' ? b.needsYouCount : 0;
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
              <span className="text-base" aria-hidden="true">
                {item.icon}
              </span>
              {t(item.labelKey)}
              {badge > 0 ? (
                <span className="unread absolute right-[22%] top-1.5">{badge}</span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </Shell>
  );
}
