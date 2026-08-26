/* ============================================================
   Activity — where the owner understands what happened.

   Approvals used to be a separate top-level view; they belong
   here, because an approval is just a work record that is
   blocked on a decision. Approvals sort first, since they are
   the only thing that needs the owner.
   ============================================================ */

import { useMemo, useState } from 'react';
import { Avatar, Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useActivity } from '@/hooks/useActivity';
import ApprovalInbox from './ApprovalInbox';
import { useT } from '@/i18n/I18nProvider';
import { Icon, stripEmoji } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useMutate, useRefresh, useSnapshot } from '@/lib/repo';
import type { Approval, Business, Tone, WorkItem } from '@/lib/types';
import type { useBusiness } from '@/hooks/useBusiness';

export type ActivityFilter = 'needs you' | 'auto' | 'done' | 'all';

function toneFor(tc: string): Tone {
  return tc === 'green' || tc === 'red' || tc === 'amber' ? tc : 'neutral';
}

function riskTone(risk: string): Tone {
  if (risk === 'high') return 'red';
  if (risk === 'medium') return 'amber';
  return 'green';
}

const WORK_STATUS: Record<string, { tone: Tone; label: string }> = {
  completed: { tone: 'green', label: 'work.done' },
  needs_approval: { tone: 'amber', label: 'work.waiting' },
  blocked: { tone: 'neutral', label: 'work.blocked' },
  failed: { tone: 'red', label: 'work.failed' },
};

const workTone = (status: string): Tone => WORK_STATUS[status]?.tone ?? 'neutral';
const workLabel = (status: string): string => WORK_STATUS[status]?.label ?? 'work.inprogress';

export default function ActivityView({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
  const toast = useToast();
  const mutate = useMutate();
  const [filter, setFilter] = useState<ActivityFilter>('needs you');
  const business: Business = b.business;
  const activity = useActivity();
  const snap = useSnapshot();
  const refresh = useRefresh();

  const indexed = useMemo(() => business.work.map((w, i) => ({ w, i })), [business.work]);

  const counts = useMemo(() => {
    let need = 0;
    let auto = 0;
    let done = 0;
    indexed.forEach(({ w, i }) => {
      if (b.workDone(i)) done += 1;
      else if (w.tag === 'needs you') need += 1;
      else auto += 1;
    });
    return { need, auto, done, all: business.work.length };
  }, [indexed, b, business.work.length]);

  const shown = useMemo(
    () =>
      indexed.filter(({ w, i }) => {
        if (filter === 'all') return true;
        if (filter === 'done') return b.workDone(i);
        if (filter === 'needs you') return !b.workDone(i) && w.tag === 'needs you';
        return !b.workDone(i) && w.tag !== 'needs you';
      }),
    [indexed, filter, b],
  );

  const TABS: { id: ActivityFilter; labelKey: string; count: number }[] = [
    { id: 'needs you', labelKey: 'work.f.need', count: counts.need },
    { id: 'auto', labelKey: 'work.f.auto', count: counts.auto },
    { id: 'done', labelKey: 'work.f.done', count: counts.done },
    { id: 'all', labelKey: 'work.f.all', count: counts.all },
  ];

  function approve(item: WorkItem, i: number) {
    b.completeWork(i);
    toast(item.cta ?? t('toast.approved'));
  }

  async function decideTool(approval: Approval, ok: boolean) {
    /* One path: the repository decides, local or remote. Awaited rather
       than fire-and-forget because the toast has to tell the truth — a
       rejected decide (already decided, or another tenant's) must not
       report success. */
    try {
      await mutate((r) => r.decideApproval(approval.id, ok));
      toast(ok ? t('appr.approved') : t('appr.rejected'));
    } catch (err) {
      toast((err as Error).message);
      return;
    }
  }

  const showApprovals = filter === 'needs you' || filter === 'all';

  /* Real work replaces the illustration outright rather than sitting
     beside it. A list mixing things that happened with things that are
     a demonstration is unreadable — the owner cannot tell which rows
     are theirs. */
  if (activity.real) {
    /* Approvals come first and are never skipped. An earlier version of
       this branch returned before the approvals block below, so a
       Telegram reply could sit waiting forever on a screen that did not
       render it — the gate raised, and no way to answer it. */
    const pending = snap.approvals.filter((a) => a.status === 'pending');
    if (pending.length === 0 && activity.data!.work.length === 0) {
      return (
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="font-pixel text-2xl tracking-tight">{t('view.work')}</h1>
            <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.work.desc')}</p>
          </header>
          <Card className="items-center py-8 text-center">
            <p className="text-sm text-text-secondary">{t('home.nothingyet')}</p>
          </Card>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-pixel text-2xl tracking-tight">{t('view.work')}</h1>
          <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.work.desc')}</p>
        </header>

        <ApprovalInbox
          approvals={pending}
          onDecided={() => {
            void refresh();
            activity.reload();
          }}
        />

        {activity.data!.work.length > 0 && (
        <Card>
          <div className="flex flex-col">
            {activity.data!.work.map((w) => (
              <div
                key={w.id}
                className="flex flex-col gap-1 border-b border-rail py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{w.objective}</span>
                  {/* Not a binary. `needs_approval` reading as red
                      "did not finish" tells the owner something broke
                      when in fact it is waiting on them, and `blocked`
                      is a setting of theirs working as intended. */}
                  <Tag tone={workTone(w.status)}>{t(workLabel(w.status))}</Tag>
                </div>
                {w.outcome && (
                  <span className="text-[13px] text-text-secondary">{w.outcome}</span>
                )}
                <span className="text-[11px] text-text-muted">
                  {new Date(w.occurredAt).toLocaleString()}
                  {w.function ? ` · ${w.function}` : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.work')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.work.desc')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-1">
          <Eyebrow>{stripEmoji(t('work.need'))}</Eyebrow>
          <span
            className={`font-pixel text-2xl tabular-nums ${counts.need + b.approvals.length ? 'text-[rgb(255_200_90)]' : ''}`}
          >
            {counts.need + b.approvals.length}
          </span>
        </Card>
        <Card className="gap-1">
          <Eyebrow>{stripEmoji(t('work.auto'))}</Eyebrow>
          <span className="font-pixel text-2xl tabular-nums">{counts.done}</span>
        </Card>
        <Card className="gap-1">
          <Eyebrow>{stripEmoji(t('work.activity'))}</Eyebrow>
          <span className="font-pixel text-2xl tabular-nums">{counts.auto + counts.done}</span>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('view.work')}>
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            role="tab"
            aria-selected={filter === tab.id}
            variant={filter === tab.id ? 'primary' : 'outline'}
            className="px-4 py-1.5 text-xs"
            onClick={() => setFilter(tab.id)}
          >
            {stripEmoji(t(tab.labelKey))} · {tab.count}
          </Button>
        ))}
      </div>

      {/* ---- Tool approvals: blocked on a decision, so they lead ---- */}
      {showApprovals && b.approvals.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('activity.approvals')}</Eyebrow>
            <p className="max-w-[66ch] text-[13px] text-text-secondary">
              {t('activity.approvals.desc')}
            </p>
          </div>
          {b.approvals.map((a) => {
            const args = Object.entries(a.args ?? {});
            const opLabel = t(`appr.op.${a.op}`);
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <Icon name="shield" size={17} />
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm">
                        {opLabel === `appr.op.${a.op}` ? a.op : opLabel} · {a.conn}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {new Date(a.ts).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <Tag tone={riskTone(a.risk)}>{t(`appr.risk.${a.risk}`)}</Tag>
                </div>
                {args.length ? (
                  <p className="text-[12px] text-text-secondary">
                    {args.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="px-4 py-1.5 text-xs"
                    onClick={() => void decideTool(a, false)}
                  >
                    {t('appr.reject')}
                  </Button>
                  <Button
                    className="px-4 py-1.5 text-xs"
                    onClick={() => void decideTool(a, true)}
                  >
                    {t('appr.approve')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ---- Work records ---- */}
      {shown.length === 0 && !(showApprovals && b.approvals.length) ? (
        <Card className="items-center py-8 text-center">
          <p className="text-[13px] text-text-muted">{t('work.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.length > 0 && b.approvals.length > 0 && showApprovals ? (
            <Eyebrow>{t('activity.history')}</Eyebrow>
          ) : null}
          {shown.map(({ w, i }) => {
            const approved = b.workDone(i);
            const needsYou = !approved && w.tag === 'needs you';
            return (
              <Card key={`${w.n}-${i}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar emoji={w.e} />
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold">{w.n}</span>
                      <span className="text-[11px] text-text-muted">{w.t}</span>
                    </div>
                  </div>
                  <Tag tone={approved ? 'green' : toneFor(w.tc)}>
                    {approved ? 'approved ✓' : w.tag}
                  </Tag>
                </div>
                <p className="text-[13px] text-text-secondary">{w.d}</p>
                {needsYou ? (
                  <div className="flex flex-wrap gap-2">
                    <Button className="px-4 py-1.5 text-xs" onClick={() => approve(w, i)}>
                      {t('work.approve')}
                    </Button>
                    <Button
                      variant="outline"
                      className="px-4 py-1.5 text-xs"
                      onClick={() => toast(t('uc.preparing'))}
                    >
                      {t('work.edit')}
                    </Button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
