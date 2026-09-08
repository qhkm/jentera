/* ============================================================
   Home — stage-driven, not a fixed layout. Setup incomplete,
   channels not connected, or operating: one clear action each.
   ============================================================ */

import { Link } from 'react-router';
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
  PlugsConnected,
} from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';
import { WorkPulse } from '@/components/WorkSignal';
import { DataIcon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import type { useBusiness } from '@/hooks/useBusiness';
import { useActivity } from '@/hooks/useActivity';
import type { ConnectionsState } from '@/hooks/useConnections';
import { milestones } from '@/lib/business';
import { useSnapshot } from '@/lib/repo';
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
  onNavigate: (v: View, businessTab?: BizTab) => void;
}) {
  const { t, lang } = useI18n();
  const now = new Date();
  const hour = now.getHours();
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
          l: t('db.stat.handled.sub'),
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
  const showTelegramNotice = connections.real && !telegramReady;
  const nextMilestone = activity.real
    ? milestones(snap, activity.data!.counters.handled, activity.data!.counters.connections).find(
        (milestone) => !milestone.done,
      )
    : null;

  const pending = business.work
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => w.tag === 'needs you' && !b.workDone(i));

  /* The line under the counter. It was unconditional for anyone signed
     in, so a business with one completed reply read "No activity yet.
     Jentera will show completed work here." directly beneath "1 handled
     automatically" — the card contradicting itself in two adjacent
     lines, because the counter comes from the run counters and this
     line came from the playbook's work list. Say it only when it is
     true; when there is activity the heading already carries it. */
  const glanceNote = demo
    ? t('home.empty')
    : activity.mode === 'pending'
      ? t('loading.home.summary')
      : activity.mode === 'error'
        ? null
        : activity.data!.counters.handled === 0 && activity.data!.counters.needsYou === 0
          ? t('home.empty')
          : null;

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
                : t('sub.step3')}
          </p>
        </div>
        <span className="home-date">
          <CalendarBlank size={16} aria-hidden="true" />
          <time
            dateTime={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`}
          >
            {now.toLocaleDateString(lang === 'bm' ? 'ms-MY' : 'en-MY', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </time>
        </span>
      </header>

      {showTelegramNotice ? (
        <Card role="status" className="home-notice gap-4 border-brand-line bg-brand-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex max-w-[62ch] flex-col gap-1">
              <Eyebrow>{t('home.telegram.eyebrow')}</Eyebrow>
              <h2 className="font-pixel text-lg tracking-tight">
                {t(
                  telegramPairing
                    ? 'home.telegram.pending.title'
                    : telegramNeedsAttention
                      ? 'home.telegram.attention.title'
                      : 'home.telegram.missing.title',
                )}
              </h2>
              <p className="text-[13px] leading-relaxed text-text-secondary">
                {t(
                  telegramPairing
                    ? 'home.telegram.pending.detail'
                    : telegramNeedsAttention
                      ? 'home.telegram.attention.detail'
                      : 'home.telegram.missing.detail',
                )}
              </p>
            </div>
            <Tag tone={telegramPairing ? 'amber' : telegramNeedsAttention ? 'red' : 'amber'}>
              {t(
                telegramPairing
                  ? 'home.telegram.pending.tag'
                  : telegramNeedsAttention
                    ? 'home.telegram.attention.tag'
                    : 'home.telegram.missing.tag',
              )}
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
                {t(
                  telegramNeedsAttention
                    ? 'home.telegram.attention.cta'
                    : 'home.telegram.missing.cta',
                )}
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

      {activity.mode === 'error' ? (
        <Card role="alert" className="home-notice gap-3">
          <p className="text-sm">{t('loading.activity.error')}</p>
          <p className="text-[13px] text-text-secondary">{activity.error?.message}</p>
          <div>
            <Button variant="outline" className="px-4 py-1.5 text-xs" onClick={activity.reload}>
              {t('loading.retry')}
            </Button>
          </div>
        </Card>
      ) : null}

      <button type="button" className="home-ask-launcher" onClick={() => onNavigate('chat')}>
        <JenteraMark size={56} />
        <span>
          <strong>{t('home.ask.title')}</strong>
          <span>{t('home.ask.detail')}</span>
        </span>
        <span className="home-ask-cta">
          {t('nav.chat')}
          <ArrowUpRight size={20} aria-hidden="true" />
        </span>
      </button>

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
      ) : (
        <Card className="home-command gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Eyebrow>{t('home.summary')}</Eyebrow>
              <h2 className="font-pixel text-lg tracking-tight">
                {t('db.handled', {
                  n: activity.real
                    ? activity.data!.counters.handled
                    : demo
                      ? business.work.filter((w) => w.tag !== 'needs you').length
                      : 0,
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
            <WorkPulse
              state={activity.real && activity.data!.counters.needsYou > 0 ? 'waiting' : 'ready'}
            />
          </div>

          {demo && pending.length ? (
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
          ) : glanceNote ? (
            <p className="text-[12px] text-text-muted">{glanceNote}</p>
          ) : null}
          {activity.real && activity.data!.counters.needsYou > 0 ? (
            <button className="home-review-link" type="button" onClick={() => onNavigate('work')}>
              <Bell size={17} aria-hidden="true" />
              {t('home.review', { n: activity.data!.counters.needsYou })}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          ) : null}
        </Card>
      )}

      {stage === 'operating' &&
      nextMilestone &&
      !(showTelegramNotice && nextMilestone.key === 'connected') ? (
        <Card className="home-next gap-4 border-brand-line bg-brand-soft">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('home.next.eyebrow')}</Eyebrow>
            <h2 className="font-pixel text-lg tracking-tight">
              {t(`home.next.${nextMilestone.key}.title`)}
            </h2>
            <p className="max-w-[62ch] text-[13px] text-text-secondary">
              {t(`home.next.${nextMilestone.key}.detail`)}
            </p>
          </div>
          <div>
            <Button
              className="px-5 py-2 text-sm"
              onClick={() => {
                if (nextMilestone.key === 'knows') onNavigate('business', 'knows');
                else if (nextMilestone.key === 'connected') onNavigate('business', 'connections');
                else onNavigate('chat');
              }}
            >
              {t(`home.next.${nextMilestone.key}.cta`)}
            </Button>
          </div>
        </Card>
      ) : null}

      {stage === 'operating' && activity.real && !nextMilestone ? (
        <Card className="home-next home-shortcuts">
          <h2 className="home-panel-title">{t('nav.business')}</h2>
          <button type="button" onClick={() => onNavigate('business', 'knows')}>
            <BookOpen size={20} weight="duotone" aria-hidden="true" />
            <span>
              <strong>{t('home.knowledge')}</strong>
              <small>
                {t('home.knowledge.count', {
                  n: snap.facts.filter((fact) => fact.confirmed).length,
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
              <p>{t('home.nothingyet')}</p>
              <button type="button" onClick={() => onNavigate('chat')}>
                {t('nav.chat')}
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
                        : w.status === 'needs_approval'
                          ? 'waiting'
                          : 'inprogress';
              return (
                <button
                  key={w.id}
                  type="button"
                  className="home-activity-row"
                  onClick={() => onNavigate('work')}
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
                    {w.outcome ? <span>{w.outcome}</span> : null}
                    <span className="home-activity-meta">
                      <span className={`home-status home-status-${status}`}>
                        {t(`work.${status}`)}
                      </span>
                      <time dateTime={w.occurredAt}>
                        {new Date(w.occurredAt).toLocaleDateString(
                          lang === 'bm' ? 'ms-MY' : 'en-MY',
                          { day: 'numeric', month: 'short' },
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
