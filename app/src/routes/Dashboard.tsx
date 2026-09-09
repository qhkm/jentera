/* ============================================================
   Two workspaces: conversations, and the business dashboard.

   Agent rosters, connections and approvals were separate views
   and read as competing technical products. They are now facts
   inside My Business, or work records inside Activity.

     Home        what happened, what needs you, what's next
     Ask Jentera   ask or instruct the private Business Assistant
     Activity    completed, active, and approval-blocked work
     My Business knowledge, responsibilities, connections
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Shell } from '@/components/Shell';
import { WorkspaceModeSwitch, type WorkspaceMode } from '@/components/WorkspaceModeSwitch';
import { Avatar, Card, Eyebrow, Progress, Tag } from '@/components/ui';
import { useBusiness } from '@/hooks/useBusiness';
import { useActivity } from '@/hooks/useActivity';
import { useConnections } from '@/hooks/useConnections';
import { useSnapshot } from '@/lib/repo';
import { milestones, readiness } from '@/lib/business';
import { useT } from '@/i18n/I18nProvider';
import { Icon, type IconName } from '@/components/Icon';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import HomeView from './views/HomeView';
import AskJenteraView from './views/AskJenteraView';
import ActivityView from './views/ActivityView';
import MyBusinessView, { type BizTab } from './views/MyBusinessView';
import { trackActivation } from '@/lib/analytics';

export type View = 'home' | 'chat' | 'work' | 'business';

const BUSINESS_TABS: BizTab[] = ['profile', 'knows', 'handles', 'connections', 'permissions'];

interface NavItem {
  id: View;
  labelKey: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: 'home' },
  { id: 'work', labelKey: 'nav.work', icon: 'activity' },
  { id: 'business', labelKey: 'nav.business', icon: 'business' },
];

export default function Dashboard() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const view: View = requestedView === 'chat' || NAV.some((item) => item.id === requestedView)
    ? (requestedView as View)
    : 'home';
  const isChat = view === 'chat';
  const requestedTab = searchParams.get('tab');
  const businessTab = BUSINESS_TABS.includes(requestedTab as BizTab) ? requestedTab as BizTab : 'profile';
  const lastDashboard = useRef<{ view: Exclude<View, 'chat'>; tab: BizTab }>({ view: 'home', tab: 'profile' });
  const trackedOpen = useRef(false);
  const b = useBusiness();
  const { business } = b;

  /** Anything blocked on the owner, from either source. */
  /* Real approvals when there is a server, the playbook's illustration
     otherwise. Mixing them put an amber "1" on the Activity tab of an
     account whose own dashboard said nothing was waiting — and reading
     `pending` as "otherwise" put that same "1" there for the length of
     the fetch, on every load. */
  const activity = useActivity();
  /* Home's Telegram notice and My Business's connection controls must
     describe the same server answer. Keeping the request here also lets a
     pending Telegram pairing clear while the owner moves between views. */
  const connections = useConnections();
  const snap = useSnapshot();
  const demo = activity.mode === 'demo';
  const needsAttention = activity.real
    ? activity.data!.counters.needsYou
    : demo
      ? b.needsYouCount + b.approvals.length
      : 0;

  // Chat owns the visible viewport, including when the mobile keyboard opens.
  useVisualViewport(isChat);

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
    if (trackedOpen.current) return;
    trackedOpen.current = true;
    trackActivation('dashboard_opened');
  }, []);

  useEffect(() => {
    if (view !== 'chat') lastDashboard.current = { view, tab: businessTab };
  }, [view, businessTab]);

  function go(next: View, businessTab?: BizTab) {
    setSearchParams({
      view: next,
      ...(next === 'business' && businessTab ? { tab: businessTab } : {}),
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function switchMode(mode: WorkspaceMode) {
    if ((mode === 'chat') === isChat) return;
    if (mode === 'chat') go('chat');
    else go(lastDashboard.current.view, lastDashboard.current.tab);
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
        className={`dashboard-nav-item flex items-center justify-between gap-2 rounded-item px-3.5 py-2.5 text-[13px] transition-colors ${
          active
            ? 'bg-brand-soft text-brand'
            : 'text-text-secondary hover:bg-[rgb(var(--border-ink)/0.05)] hover:text-text'
        }`}
      >
        <span className="flex items-center gap-2.5">
          <span className="dashboard-nav-icon">
            <Icon name={item.icon} size={19} weight={active ? 'duotone' : 'regular'} />
          </span>
          {t(item.labelKey)}
        </span>
        {badge > 0 ? <Tag tone="amber">{badge}</Tag> : null}
      </button>
    );
  }

  const profile = (
    <Card className="dashboard-profile gap-2">
      <button
        type="button"
        className="flex items-center gap-3 text-left"
        onClick={() => go('business')}
        aria-label={t('home.profile.open')}
      >
        <Avatar emoji={business.icon} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{business.name}</span>
          <span className="truncate text-[11px] text-text-muted">{business.loc}</span>
        </div>
      </button>
      {/* Real progress for a real business; the playbook's projection
          for the demo. "Jentera can handle 82%" was the same number for
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
      className={`dashboard-shell workspace-shell ${isChat ? 'dashboard-chat workspace-chat' : 'workspace-dashboard'}`}
      navigation={<WorkspaceModeSwitch mode={isChat ? 'chat' : 'dashboard'} onChange={switchMode} needsAttention={needsAttention} />}
      fullBleed={isChat}
    >
      <div
        className={`workspace-layout flex flex-col gap-8 lg:flex-row lg:pb-0 ${isChat ? '' : 'pb-24'}`}
      >
        {!isChat && <aside className="dashboard-sidebar hidden shrink-0 flex-col gap-6 lg:flex lg:w-[220px]">
          {profile}
          <nav className="flex flex-col gap-1" aria-label={t('workspace.mode.dashboard')}>
            {NAV.map(navButton)}
          </nav>
          <div className="dashboard-sidebar-note">
            <Icon name="shield" size={17} />
            <span>{t('home.workspace.private')}</span>
          </div>
        </aside>}

        <div className="dashboard-content min-w-0 flex-1">
          {view === 'home' && <HomeView b={b} connections={connections} onNavigate={go} />}
          {/* Keep the owner conversation mounted while they inspect another
              section. Returning to Ask Jentera must not erase the exchange. */}
          <div className={isChat ? 'workspace-chat-panel' : 'hidden'} hidden={!isChat}>
            <AskJenteraView
              business={business}
              handled={handled}
              needs={needsAttention}
              firstRun={searchParams.get('first') === '1'}
              active={view === 'chat'}
              workspace
              onOpenActivity={() => go('work')}
              onOpenConnections={() => go('business', 'connections')}
              onOpenKnowledge={() => go('business', 'knows')}
            />
          </div>
          {view === 'work' && <ActivityView b={b} onOpenAsk={() => go('chat')} />}
          {view === 'business' && (
            <MyBusinessView
              b={b}
              connections={connections}
              initialTab={businessTab}
              onTabChange={(tab) => setSearchParams({ view: 'business', tab })}
            />
          )}
        </div>
      </div>

      {/* Chat has its own navigation; business sections stay in Dashboard. */}
      {!isChat && <nav
        className="dashboard-bottom-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-rail bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label={t('workspace.mode.dashboard')}
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
      </nav>}
    </Shell>
  );
}
