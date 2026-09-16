/* ============================================================
   Two workspaces: conversations, and the business dashboard.

   Agent rosters, connections and approvals were separate views
   and read as competing technical products. They are now facts
   inside My Business, or work records inside Activity.

     Home        what happened, what needs you, what's next
     Ask Jentera   ask or instruct the private Chief of Staff
     Activity    completed, active, and approval-blocked work
     My Business knowledge, responsibilities, connections
   ============================================================ */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Shell } from '@/components/Shell';
import { WorkspaceModeSwitch, type WorkspaceMode } from '@/components/WorkspaceModeSwitch';
import { Avatar, Card, Eyebrow, Progress, Tag } from '@/components/ui';
import { useBusiness } from '@/hooks/useBusiness';
import { useActivity } from '@/hooks/useActivity';
import { useConnections } from '@/hooks/useConnections';
import { useRepository, useSnapshot } from '@/lib/repo';
import { useRoutinesEnabled, useSignedIn } from '@/lib/repo/gate';
import { milestones, readiness } from '@/lib/business';
import { useT } from '@/i18n/I18nProvider';
import { Icon, type IconName } from '@/components/Icon';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import HomeView from './views/HomeView';
import AskJenteraView from './views/AskJenteraView';
import ActivityView from './views/ActivityView';
import MyBusinessView, { type BizTab } from './views/MyBusinessView';
import { trackActivation } from '@/lib/analytics';
import { isRunId } from '@/lib/task';
import RoutinesView from './views/RoutinesView';
import NotificationsView from './views/NotificationsView';
import FilesView from './views/FilesView';
import LibraryView from './views/LibraryView';
import GoalsView from './views/GoalsView';
import type { RoutineConfig } from '@/lib/routines/types';
import { BottomNav } from '@/components/BottomNav';
import { useNotifications } from '@/hooks/useNotifications';
import { ComputerStatus } from '@/components/ComputerStatus';
import { isPwaStandalone } from '@/pwa/install';

export type View = 'home' | 'chat' | 'work' | 'files' | 'library' | 'goals' | 'routines' | 'notifications' | 'business';

const BUSINESS_TABS: BizTab[] = ['profile', 'knows', 'handles', 'connections', 'permissions', 'team'];

interface NavItem {
  id: View;
  labelKey: string;
  icon: IconName;
  section: 'overview' | 'work' | 'workspace';
}

const NAV: NavItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: 'home', section: 'overview' },
  { id: 'work', labelKey: 'nav.work', icon: 'activity', section: 'work' },
  { id: 'library', labelKey: 'nav.library', icon: 'library', section: 'workspace' },
  { id: 'goals', labelKey: 'nav.goals', icon: 'goals', section: 'work' },
  { id: 'files', labelKey: 'nav.files', icon: 'files', section: 'workspace' },
  { id: 'notifications', labelKey: 'notifications.title', icon: 'notifications', section: 'overview' },
  { id: 'business', labelKey: 'nav.business', icon: 'business', section: 'workspace' },
];

const NAV_SECTIONS: { id: NavItem['section']; labelKey: string }[] = [
  { id: 'overview', labelKey: 'sidebar.overview' },
  { id: 'work', labelKey: 'sidebar.work' },
  { id: 'workspace', labelKey: 'sidebar.workspace' },
];

export default function Dashboard() {
  const t = useT();
  const sidebarId = useId();
  const repository = useRepository();
  const signedIn = useSignedIn();
  const routinesEnabled = useRoutinesEnabled() && !!repository.routines;
  const goalsEnabled = signedIn && !!repository.goals;
  const availableNav = goalsEnabled ? NAV : NAV.filter((item) => item.id !== 'goals');
  const nav: NavItem[] = routinesEnabled
    ? [...availableNav.slice(0, 3), { id: 'routines', labelKey: 'routines.title', icon: 'routines', section: 'work' }, ...availableNav.slice(3)]
    : availableNav;
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const view: View = requestedView === 'chat' || nav.some((item) => item.id === requestedView)
    ? (requestedView as View)
    : 'home';
  const isChat = view === 'chat';
  const requestedTab = searchParams.get('tab');
  const businessTab = BUSINESS_TABS.includes(requestedTab as BizTab) ? requestedTab as BizTab : 'profile';
  const focusedReviewId = view === 'work' ? searchParams.get('review') : null;
  const focusedRunId = view === 'work' ? focusedReviewId ?? searchParams.get('run') : null;
  const [taskContext, setTaskContext] = useState<{ runId: string; title?: string } | null>(null);
  const [taskDraft, setTaskDraft] = useState<{ text: string; key: number; sessionId?: string; goalId?: string; goalTitle?: string; goalCheckpointId?: string; goalCheckpointTitle?: string } | null>(null);
  const [playbookDraft, setPlaybookDraft] = useState<RoutineConfig | null>(null);
  const focusedRoutineId = view === 'routines' ? searchParams.get('routine') : null;
  const lastDashboard = useRef<{ view: Exclude<View, 'chat'>; tab: BizTab; runId: string | null; routineId: string | null; reviewId: string | null }>({ view: 'home', tab: 'profile', runId: null, routineId: null, reviewId: null });
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
  const notifications = useNotifications();
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
    if (isPwaStandalone()) trackActivation('installed_app_opened');
  }, []);

  useEffect(() => {
    if (view !== 'chat') lastDashboard.current = { view, tab: businessTab, runId: focusedRunId, routineId: focusedRoutineId, reviewId: focusedReviewId };
  }, [view, businessTab, focusedRunId, focusedRoutineId, focusedReviewId]);

  function go(next: View, businessTab?: BizTab, runId?: string | null, routineId?: string | null) {
    setSearchParams({
      view: next,
      ...(next === 'business' && businessTab ? { tab: businessTab } : {}),
      ...(next === 'work' && runId ? { run: runId } : {}),
      ...(next === 'routines' && routineId ? { routine: routineId } : {}),
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function switchMode(mode: WorkspaceMode) {
    if ((mode === 'chat') === isChat) return;
    if (mode === 'chat') go('chat');
    else if (lastDashboard.current.reviewId) setSearchParams({ view: 'work', review: lastDashboard.current.reviewId });
    else go(lastDashboard.current.view, lastDashboard.current.tab, lastDashboard.current.runId, lastDashboard.current.routineId);
  }

  function openTask(runId?: string, title?: string) {
    if (!isRunId(runId)) { go('work'); return; }
    setTaskContext({ runId, title });
    go('work', undefined, runId);
  }

  function navButton(item: NavItem) {
    const active = view === item.id;
    const badge = item.id === 'work' ? needsAttention : item.id === 'notifications' ? notifications.unread : 0;
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

  const [computerStatusTarget, setComputerStatusTarget] = useState<HTMLDivElement | null>(null);
  return (
    <Shell
      accountAccessory={<div className="computer-status-header-slot" ref={setComputerStatusTarget} />}
      className={`dashboard-shell workspace-shell ${isChat ? 'dashboard-chat workspace-chat' : 'workspace-dashboard'}`}
      navigation={<WorkspaceModeSwitch mode={isChat ? 'chat' : 'dashboard'} onChange={switchMode} needsAttention={needsAttention} />}
      fullBleed={isChat}
    >
      <div
        className={`workspace-layout flex flex-col gap-8 lg:flex-row lg:pb-0 ${isChat ? '' : 'pb-24'}`}
      >
        {!isChat && <aside className="dashboard-sidebar hidden shrink-0 flex-col gap-6 lg:flex lg:w-[220px]">
          {profile}
          <nav className="dashboard-sidebar-nav" aria-label={t('workspace.mode.dashboard')}>
            {NAV_SECTIONS.map(section => {
              const items = nav.filter(item => item.section === section.id);
              if (!items.length) return null;
              const headingId = `${sidebarId}-${section.id}`;
              return <div key={section.id} className="dashboard-nav-section" role="group" aria-labelledby={headingId}>
                <h2 id={headingId}>{t(section.labelKey)}</h2>
                <div className="dashboard-nav-section-items">{items.map(navButton)}</div>
              </div>;
            })}
          </nav>
          <div className="dashboard-sidebar-note">
            <Icon name="shield" size={17} />
            <span>{t('home.workspace.private')}</span>
          </div>
        </aside>}

        <div className="dashboard-content min-w-0 flex-1">
          <ComputerStatus mobileTarget={computerStatusTarget} onOpenChat={isChat ? undefined : () => go('chat')} onOpenKnowledge={() => go('business', 'knows')} onOpenActivity={openTask} />
          {view === 'home' && <HomeView b={b} connections={connections} goalsEnabled={goalsEnabled} onNavigate={go} />}
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
              taskDraft={taskDraft}
              onOpenActivity={openTask}
              onOpenConnections={() => go('business', 'connections')}
              onOpenKnowledge={() => go('business', 'knows')}
            />
          </div>
          {view === 'work' && <ActivityView
            b={b}
            onOpenAsk={(context, sessionId) => {
              if (context) setTaskDraft({ text: context, key: Date.now(), sessionId });
              go('chat');
            }}
            runId={focusedRunId}
            reviewOnly={Boolean(focusedReviewId)}
            taskTitle={taskContext?.runId === focusedRunId ? taskContext.title : undefined}
            onOpenTask={openTask}
            onCloseTask={() => go('work')}
          />}
          {view === 'files' && <FilesView onOpenTask={(runId) => openTask(runId)} />}
          {view === 'library' && <LibraryView canSchedule={routinesEnabled} connections={connections} onUse={config => {
            setPlaybookDraft(config); go('routines');
          }} />}
          {view === 'goals' && goalsEnabled && <GoalsView onWork={(goal, checkpoint) => {
            setTaskDraft({
              key: Date.now(),
              goalId: goal.id,
              goalTitle: goal.title,
              ...(checkpoint ? {
                goalCheckpointId: checkpoint.id,
                goalCheckpointTitle: checkpoint.title,
              } : {}),
              text: t(checkpoint ? 'goals.work.stepPrompt' : 'goals.work.prompt', {
                title: goal.title,
                step: checkpoint?.title ?? '',
                criteria: goal.successCriteria || t('goals.criteria.none'),
                date: goal.targetDate || t('goals.date.none'),
              }),
            });
            go('chat');
          }} />}
          {view === 'notifications' && <NotificationsView
            state={notifications}
            onOpenTask={openTask}
            onOpenReview={(runId) => setSearchParams({ view: 'work', review: runId })}
            onOpenRoutine={(id) => go('routines', undefined, null, id)}
          />}
          {view === 'business' && (
            <MyBusinessView
              b={b}
              connections={connections}
              initialTab={businessTab}
              onTabChange={(tab) => setSearchParams({ view: 'business', tab })}
            />
          )}
          {routinesEnabled && repository.routines && <div hidden={view !== 'routines'} className={view === 'routines' ? '' : 'hidden'}>
            <RoutinesView api={repository.routines} active={view === 'routines'}
              playbookDraft={playbookDraft} onDraftConsumed={() => setPlaybookDraft(null)}
              onBrowseLibrary={() => go('library')}
              selectedId={view === 'routines' ? focusedRoutineId : lastDashboard.current.routineId}
              onSelect={(id) => go('routines', undefined, null, id)} onOpenTask={openTask} />
          </div>}
        </div>
      </div>

      {/* Chat has its own navigation; business sections stay in Dashboard. */}
      {!isChat && <BottomNav
        label={t('workspace.mode.dashboard')}
        current={view}
        onGo={(next) => go(next)}
        onChat={() => switchMode('chat')}
        items={nav.map((item) => ({
          id: item.id,
          icon: item.icon,
          label: t(item.id === 'notifications' ? 'notifications.short' : item.labelKey),
          badge: item.id === 'work' ? needsAttention : item.id === 'notifications' ? notifications.unread : 0,
        }))}
      />}
    </Shell>
  );
}
