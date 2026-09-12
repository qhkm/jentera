/* ============================================================
   Home — stage-driven, not a fixed layout. Setup incomplete,
   channels not connected, or operating: one clear action each.
   ============================================================ */

import { Link } from 'react-router';
import { hasConfirmedValue } from '@/lib/knowledge';
import { Avatar, Button, Card, Eyebrow, LoadingState, Tag } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import {
  ArrowUpRight,
  Bell,
  CalendarBlank,
  CheckCircle,
  Clock,
  ArrowRight,
  BookOpen,
  ChatCircle,
  Lightning,
  PlugsConnected,
  SquaresFour,
} from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';
import { WorkPulse } from '@/components/WorkSignal';
import { DataIcon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import type { useBusiness } from '@/hooks/useBusiness';
import { useActivity } from '@/hooks/useActivity';
import type { ConnectionsState } from '@/hooks/useConnections';
import { useSnapshot } from '@/lib/repo';
import { DailyBrief } from '@/components/DailyBrief';
import { useBusinessClock } from '@/hooks/useBusinessClock';
import { BUSINESS_TIME_ZONE, malaysiaDay } from '@/lib/daily-brief';
import { isRunId } from '@/lib/task';
import type { View } from '../Dashboard';
import type { BizTab } from './MyBusinessView';

/** The three counters, in the order they are rendered when real. */
const PENDING_STATS = ['handled', 'needs', 'saved'] as const;
const STAT_ICONS = [CheckCircle, Bell, Clock];

export default function HomeView({
  b,
  connections,
  onNavigate,
}: {
  b: ReturnType<typeof useBusiness>;
  connections: ConnectionsState;
  onNavigate: (v: View, businessTab?: BizTab, runId?: string) => void;
}) {
  const { t, lang } = useI18n();
  const now = useBusinessClock();
  const hour = Number(new Intl.DateTimeFormat('en-MY', { timeZone: BUSINESS_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const activity = useActivity();
  const snap = useSnapshot();
  /* The illustration belongs to the anonymous demo alone. While a
     signed-in owner's figures are still in flight the layout is the
     real one, empty — not someone else's dashboard that then has to
     be taken away from them. */
  const demo = activity.mode === 'demo';

  /* Only when the figures are genuinely this business's. A signed-in
     owner with nothing done yet sees three zeros and a reason why,
     which is honest; borrowing the demo's numbers would not be. */
  const realStats = activity.real
    ? [
        {
          d: t('db.stat.handled'),
          v: String(activity.data!.counters.handled),
          u: '',
          l: t('brief.handled.total'),
        },
        {
          d: t('db.stat.needs'),
          v: String(activity.data!.counters.needsYou),
          u: '',
          l: t('db.stat.needs.sub'),
        },
        {
          d: t('db.stat.saved'),
          v: String(Math.round(activity.data!.counters.minutesSaved / 6) / 10),
          u: t('db.stat.saved.unit'),
          l: t('db.stat.saved.sub'),
        },
      ]
    : null;
  const toast = useToast();
  const { business, stage } = b;
  const telegramReady =
    connections.real &&
    (connections.rows ?? []).some(
      (row) => row.connector === 'telegram' && row.status === 'connected' && row.paired === true,
    );
  const telegramPairing = connections.real
    ? (connections.rows ?? []).find(
        (row) =>
          row.connector === 'telegram' &&
          row.status === 'connected' &&
          row.paired !== true &&
          Boolean(row.pairingUrl),
      )
    : undefined;
  const telegramNeedsAttention =
    connections.real &&
    (connections.rows ?? []).some(
      (row) => row.connector === 'telegram' && row.status !== 'connected',
    );
  /* Telegram is optional: the app is the owner chat. The card appears only
     for a bot the owner has already saved and that still needs something,
     never as a standing nag to set one up. */
  const showTelegramNotice = connections.real && !telegramReady &&
    (Boolean(telegramPairing) || telegramNeedsAttention);

  const pending = business.work
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => w.tag === 'needs you' && !b.workDone(i));

  return (
    <div className="home-view">
      <header className="home-heading">
        <div>
          <Eyebrow>{business.name}</Eyebrow>
          <h1 className="font-pixel tracking-tight">{t(`home.greeting.${greeting}`)}</h1>
          <p className="text-sm text-text-secondary">
            {stage === 'setup'
              ? t('sub.step1')
              : stage === 'connect'
                ? t('sub.step2')
                : t('brief.homeDetail')}
          </p>
        </div>
        <span className="home-date">
          <CalendarBlank size={16} aria-hidden="true" />
          <time
            dateTime={malaysiaDay(now)}
          >
            {now.toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-MY', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: BUSINESS_TIME_ZONE,
            })}
          </time>
        </span>
      </header>

      <section className="home-actions" aria-label={t('home.actions')}>
        <button type="button" className="home-action home-action-chat" onClick={() => onNavigate('chat')}>
          <span className="home-action-icon"><ChatCircle size={22} weight="duotone" aria-hidden="true" /></span>
          <span><strong>{t('home.action.chat')}</strong><small>{t('home.action.chat.detail')}</small></span>
        </button>
        <button type="button" className="home-action home-action-activity" onClick={() => onNavigate('work')}>
          <span className="home-action-icon"><Lightning size={22} weight="duotone" aria-hidden="true" /></span>
          <span><strong>{t('home.action.activity')}</strong><small>{t('home.action.activity.detail')}</small></span>
        </button>
        <button
          type="button"
          className="home-action home-action-alerts"
          onClick={() => onNavigate('notifications')}
        >
          <span className="home-action-icon"><Bell size={22} weight="duotone" aria-hidden="true" /></span>
          <span><strong>{t('home.action.alerts')}</strong><small>{t('home.action.alerts.detail')}</small></span>
        </button>
        <button type="button" className="home-action home-action-more" onClick={() => onNavigate('business')}>
          <span className="home-action-icon"><SquaresFour size={22} weight="duotone" aria-hidden="true" /></span>
          <span><strong>{t('home.action.business')}</strong><small>{t('home.action.business.detail')}</small></span>
        </button>
      </section>

      {!demo && <DailyBrief activity={activity} snapshot={snap} now={now} onNavigate={onNavigate} />}

      {showTelegramNotice ? (
        <Card role="status" className="home-notice gap-4 border-brand-line bg-brand-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex max-w-[62ch] flex-col gap-1">
              <Eyebrow>{t('home.telegram.eyebrow')}</Eyebrow>
              <h2 className="font-pixel text-lg tracking-tight">
                {t(telegramPairing ? 'home.telegram.pending.title' : 'home.telegram.attention.title')}
              </h2>
              <p className="text-[13px] leading-relaxed text-text-secondary">
                {t(telegramPairing ? 'home.telegram.pending.detail' : 'home.telegram.attention.detail')}
              </p>
            </div>
            <Tag tone={telegramPairing ? 'amber' : 'red'}>
              {t(telegramPairing ? 'home.telegram.pending.tag' : 'home.telegram.attention.tag')}
            </Tag>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {telegramPairing?.pairingUrl ? (
              <a
                className="btn btn-primary"
                href={telegramPairing.pairingUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('home.telegram.pending.cta')}
              </a>
            ) : (
              <Button
                className="px-5 py-2 text-sm"
                onClick={() => onNavigate('business', 'connections')}
              >
                {t('home.telegram.attention.cta')}
              </Button>
            )}
            {telegramPairing ? (
              <Button
                variant="ghost"
                className="px-4 py-2 text-xs"
                onClick={() => onNavigate('business', 'connections')}
              >
                {t('home.telegram.details')}
              </Button>
            ) : null}
          </div>

          {telegramPairing ? (
            <p className="text-[11px] text-text-muted">{t('home.telegram.pending.note')}</p>
          ) : null}
        </Card>
      ) : null}

      {demo && <button type="button" className="home-ask-launcher" onClick={() => onNavigate('chat')}>
        <JenteraMark size={56} />
        <span>
          <strong>{t('home.ask.title')}</strong>
          <span>{t('home.ask.detail')}</span>
        </span>
        <span className="home-ask-cta">
          {t('nav.chat')}
          <ArrowUpRight size={20} aria-hidden="true" />
        </span>
      </button>}

      {/* Real figures when there is a server to ask; the playbook's
          illustrations otherwise. Never a mix — an owner cannot tell
          which half of a blended row is true. */}
      <div
        className="home-metrics grid gap-3 sm:grid-cols-3"
        role="region"
        aria-busy={activity.mode === 'pending'}
        aria-label={activity.mode === 'pending' ? t('loading.home.metrics') : t('home.metrics')}
      >
        {realStats
          ? realStats.map((s, index) => {
              const Glyph = STAT_ICONS[index];
              return (
                <Card key={s.d} className={`home-stat home-stat-${PENDING_STATS[index]} gap-3`}>
                  <div className="home-stat-label">
                    <Eyebrow>{s.d}</Eyebrow>
                    <Glyph size={18} weight="duotone" aria-hidden="true" />
                  </div>
                  <span className="font-pixel text-3xl tabular-nums">
                    {s.v}
                    {s.u ? <span className="text-lg text-text-muted">{s.u}</span> : null}
                  </span>
                  <span className="text-[13px] text-text-secondary">{s.l}</span>
                </Card>
              );
            })
          : demo
            ? business.stats.map((s) => (
                <Card key={s.d} className="home-stat gap-3">
                  <Eyebrow>{s.d}</Eyebrow>
                  <span className="font-pixel text-3xl tabular-nums">
                    {s.v}
                    {s.u ? <span className="text-lg text-text-muted">{s.u}</span> : null}
                  </span>
                  <span className="text-[13px] text-text-secondary">{s.l}</span>
                  {s.s ? <span className="text-[11px] text-text-muted">{s.s}</span> : null}
                </Card>
              ))
            : /* Same three cards, same three lines, no numbers. The
                 labels are already known — only the figures are in
                 flight — so the row lands at its final height and the
                 counts fill in where the dashes were. */
              PENDING_STATS.map((k) => (
                <Card key={k} className="home-stat gap-3" aria-hidden="true">
                  <Eyebrow>{t(`db.stat.${k}`)}</Eyebrow>
                  <span className="font-pixel text-3xl tabular-nums text-text-muted">—</span>
                  <span className="text-[13px] text-text-secondary">{t(`db.stat.${k}.sub`)}</span>
                </Card>
              ))}
      </div>

      {/* Stack independently: long recent-work entries must not stretch
          the space between the summary and the owner's next action. */}
      <div className="home-overview">
        {stage !== 'operating' ? (
          <Card className="home-command gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Eyebrow>{t(stage === 'setup' ? 'cmd.step1.title' : 'cmd.step2.title')}</Eyebrow>
                <h2 className="font-pixel text-lg tracking-tight">
                  {t(stage === 'setup' ? 'cmd.step1.head' : 'cmd.step2.head')}
                </h2>
                <p className="text-[13px] text-text-secondary">
                  {t(stage === 'setup' ? 'cmd.step1.body' : 'cmd.step2.body')}
                </p>
              </div>
              <Tag tone="amber">{stage === 'setup' ? 'setup' : t('cmd.step2.tag')}</Tag>
            </div>
            <div className="flex flex-wrap gap-2">
              {stage === 'setup' ? (
                <Link to="/setup">
                  <Button className="px-5 py-2 text-sm">{t('cmd.step1.cta')}</Button>
                </Link>
              ) : (
                <Button
                  className="px-5 py-2 text-sm"
                  onClick={() => onNavigate('business', 'connections')}
                >
                  {t('cmd.step2.cta')}
                </Button>
              )}
            </div>
          </Card>
        ) : demo ? (
          <Card className="home-command gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Eyebrow>{t('home.summary')}</Eyebrow>
                <h2 className="font-pixel text-lg tracking-tight">
                  {t('db.handled', {
                    n: business.work.filter((w) => w.tag !== 'needs you').length,
                  })}
                </h2>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-secondary">
                  {business.team.slice(0, 3).map((m) => (
                    <span key={m.n} className="inline-flex items-center gap-1.5">
                      <DataIcon emoji={m.e} size={14} />
                      {m.n}
                    </span>
                  ))}
                </p>
              </div>
              {/* "live" is a claim about now. An agent roster with
                nothing behind it is a capability list, and saying
                otherwise on a dashboard whose own counters read zero
                is the sort of small untruth that makes a person stop
                believing the rest. */}
              <WorkPulse state="ready" />
            </div>

            {pending.length ? (
              pending.map(({ w, i }) => (
                <div
                  key={i}
                  className="flex flex-wrap items-start justify-between gap-3 border-t border-rail pt-3"
                >
                  <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-1.5 text-[13px]">
                      <DataIcon emoji={w.e} size={14} />
                      {w.n}
                    </span>
                    <span className="text-[12px] text-text-secondary">{w.d}</span>
                  </div>
                  <Button
                    className="px-4 py-1 text-xs"
                    onClick={() => {
                      b.completeWork(i);
                      toast(w.cta ?? t('toast.approved'));
                    }}
                  >
                    {t('work.respond')}
                  </Button>
                </div>
              ))
            ) : <p className="text-[12px] text-text-muted">{t('home.empty')}</p>}
          </Card>
        ) : null}

        {stage === 'operating' && activity.real ? (
          <Card className="home-next home-shortcuts">
            <h2 className="home-panel-title">{t('nav.business')}</h2>
            <button type="button" onClick={() => onNavigate('business', 'knows')}>
              <BookOpen size={20} weight="duotone" aria-hidden="true" />
              <span>
                <strong>{t('home.knowledge')}</strong>
                <small>
                  {t('home.knowledge.count', {
                    n: snap.facts.filter(hasConfirmedValue).length,
                  })}
                </small>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onNavigate('business', 'connections')}>
              <PlugsConnected size={20} weight="duotone" aria-hidden="true" />
              <span>
                <strong>{t('home.connections')}</strong>
                <small>{t('home.connections.detail')}</small>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </Card>
        ) : null}
      </div>

      {/* Latest agent activity — a way into Chat */}
      <Card className="home-recent gap-3">
        <div className="flex items-center justify-between">
          <h2 className="home-panel-title">{t('home.recent')}</h2>
          <button
            type="button"
            className="home-activity-link text-[11px] text-brand hover:underline"
            onClick={() => onNavigate('work')}
          >
            {t('home.openactivity')}
          </button>
        </div>
        {activity.real ? (
          activity.data!.work.length === 0 ? (
            /* A signed-in owner with nothing done yet gets told what to
               do about it, not a borrowed example of someone else's
               activity. */
            <div className="home-empty">
              <CheckCircle size={30} weight="duotone" aria-hidden="true" />
              <p>{t(activity.data!.counters.handled > 0 ? 'brief.noRecent' : 'brief.noHistory')}</p>
              <button type="button" onClick={() => onNavigate(activity.data!.counters.handled > 0 ? 'work' : 'chat')}>
                {t(activity.data!.counters.handled > 0 ? 'view.work' : 'nav.chat')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            activity.data!.work.slice(0, 4).map((w) => {
              const status =
                w.status === 'completed'
                  ? 'done'
                  : w.status === 'cancelled'
                    ? 'declined'
                    : w.status === 'failed'
                      ? 'failed'
                      : w.status === 'blocked'
                        ? 'blocked'
                        : ['needs_approval', 'needs_input', 'needs_review'].includes(w.status)
                          ? 'waiting'
                          : 'inprogress';
              return (
                <button
                  key={w.id}
                  type="button"
                  className="home-activity-row"
                  onClick={() => onNavigate('work', undefined, isRunId(w.runId) && w.canOpen !== false ? w.runId : undefined)}
                >
                  <WorkPulse
                    compact
                    state={
                      status === 'done' || status === 'declined'
                        ? 'done'
                        : status === 'failed'
                          ? 'failed'
                          : status === 'waiting' || status === 'blocked'
                            ? 'waiting'
                            : 'working'
                    }
                  />
                  <span className="home-activity-copy">
                    <strong>{w.objective}</strong>
                    {w.outcome ? <span className="home-activity-outcome">{w.outcome}</span> : null}
                    <span className="home-activity-meta">
                      <span className={`home-status home-status-${status}`}>
                        {t(w.status === 'needs_review' ? 'task.needsReview' : w.status === 'needs_input' ? 'task.needsInput' : `work.${status}`)}
                      </span>
                      <time dateTime={w.occurredAt}>
                        {new Date(w.occurredAt).toLocaleDateString(
                          lang === 'bm' ? 'ms-MY' : 'en-MY',
                          { day: 'numeric', month: 'short', timeZone: BUSINESS_TIME_ZONE },
                        )}
                      </time>
                    </span>
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              );
            })
          )
        ) : demo ? (
          business.work.slice(0, 2).map((w, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <Avatar emoji={w.e} size={14} className="size-7" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12px] font-semibold">{w.n}</span>
                <span className="text-[12px] leading-snug text-text-secondary">{w.d}</span>
              </div>
            </div>
          ))
        ) : activity.mode === 'error' ? (
          <p className="text-[12px] leading-snug text-text-secondary">
            {t('loading.activity.unavailable')}
          </p>
        ) : (
          <LoadingState
            compact
            title={t('loading.home.recent')}
            detail={t('loading.home.recent.detail')}
          />
        )}
      </Card>
    </div>
  );
}
