/* ============================================================
   Home — stage-driven, not a fixed layout. Setup incomplete,
   channels not connected, or operating: one clear action each.
   ============================================================ */

import { Link } from 'react-router';
import { Avatar, Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { DataIcon, stripEmoji } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import type { useBusiness } from '@/hooks/useBusiness';
import { useActivity } from '@/hooks/useActivity';
import type { View } from '../Dashboard';

/** The three counters, in the order they are rendered when real. */
const PENDING_STATS = ['handled', 'needs', 'saved'] as const;

export default function HomeView({
  b,
  onNavigate,
}: {
  b: ReturnType<typeof useBusiness>;
  onNavigate: (v: View) => void;
}) {
  const t = useT();
  const activity = useActivity();
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

  const pending = business.work
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => w.tag === 'needs you' && !b.workDone(i));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{stripEmoji(t('view.home.greet'))}</h1>
        <p className="text-sm text-text-secondary">
          {stage === 'setup' ? t('sub.step1') : stage === 'connect' ? t('sub.step2') : t('sub.step3')}
        </p>
      </header>

      {stage !== 'operating' ? (
        <Card className="gap-4">
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
              <Button className="px-5 py-2 text-sm" onClick={() => onNavigate('business')}>
                {t('cmd.step2.cta')}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card className="gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Eyebrow>{t('cmd.step3.title')}</Eyebrow>
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
            {demo || (activity.real && activity.data!.counters.handled > 0) ? (
              <Tag tone="green">live</Tag>
            ) : (
              <Tag>{t('roster.ready')}</Tag>
            )}
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
          ) : (
            <p className="text-[12px] text-text-muted">
              {t('home.empty')}
            </p>
          )}
        </Card>
      )}

      {/* Real figures when there is a server to ask; the playbook's
          illustrations otherwise. Never a mix — an owner cannot tell
          which half of a blended row is true. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {realStats
          ? realStats.map((s) => (
              <Card key={s.d} className="gap-3">
                <Eyebrow>{s.d}</Eyebrow>
                <span className="font-pixel text-3xl tabular-nums">
                  {s.v}
                  {s.u ? <span className="text-lg text-text-muted">{s.u}</span> : null}
                </span>
                <span className="text-[13px] text-text-secondary">{s.l}</span>
              </Card>
            ))
          : demo
            ? business.stats.map((s) => (
                <Card key={s.d} className="gap-3">
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
                <Card key={k} className="gap-3">
                  <Eyebrow>{t(`db.stat.${k}`)}</Eyebrow>
                  <span className="font-pixel text-3xl tabular-nums text-text-muted">—</span>
                  <span className="text-[13px] text-text-secondary">{t(`db.stat.${k}.sub`)}</span>
                </Card>
              ))}
      </div>

      {/* Latest agent activity — a way into Chat */}
      <Card className="gap-3">
        <div className="flex items-center justify-between">
          <Eyebrow>{t('home.recent')}</Eyebrow>
          <button
            type="button"
            className="text-[11px] text-brand hover:underline"
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
            <p className="text-[12px] leading-snug text-text-secondary">
              {t('home.nothingyet')}
            </p>
          ) : (
            activity.data!.work.slice(0, 3).map((w) => (
              <div key={w.id} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12px] font-semibold">{w.objective}</span>
                {w.outcome && (
                  <span className="text-[12px] leading-snug text-text-secondary">{w.outcome}</span>
                )}
              </div>
            ))
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
        ) : (
          /* One line, which is what an owner with no activity ends up
             with. Two demo entries here and one real line after was a
             third of the jump on every load. */
          <p className="text-[12px] leading-snug text-text-secondary">&nbsp;</p>
        )}
      </Card>
    </div>
  );
}
