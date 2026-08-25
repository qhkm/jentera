/* ============================================================
   Activity — where the owner understands what happened.

   Approvals used to be a separate top-level view; they belong
   here, because an approval is just a work record that is
   blocked on a decision. Approvals sort first, since they are
   the only thing that needs the owner.
   ============================================================ */

import { useMemo, useState } from 'react';
import { Avatar, Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { Icon, stripEmoji } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useMutate } from '@/lib/repo';
import { decideApprovalRemote } from '@/lib/api';
import type { Approval, Business, Tone, WorkItem } from '@/lib/types';
import type { useBusiness } from '@/hooks/useBusiness';

/* Writes are fire-and-forget by design; the provider surfaces failures
   centrally, so this only stops an unhandled rejection. */
const noop = () => {};

export type ActivityFilter = 'needs you' | 'auto' | 'done' | 'all';

function toneFor(tc: string): Tone {
  return tc === 'green' || tc === 'red' || tc === 'amber' ? tc : 'neutral';
}

function riskTone(risk: string): Tone {
  if (risk === 'high') return 'red';
  if (risk === 'medium') return 'amber';
  return 'green';
}

export default function ActivityView({ b }: { b: ReturnType<typeof useBusiness> }) {
  const t = useT();
  const toast = useToast();
  const mutate = useMutate();
  const [filter, setFilter] = useState<ActivityFilter>('needs you');
  const business: Business = b.business;

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
    if (approval.remoteId) {
      try {
        const res = await decideApprovalRemote(approval.remoteId, ok);
        toast(res.detail ?? (ok ? t('appr.approved') : t('appr.rejected')));
      } catch (err) {
        toast(`Could not reach the server: ${(err as Error).message}`);
        return;
      }
    } else {
      void mutate((r) => r.decideApproval(approval.id, ok)).catch(noop);
      toast(ok ? t('appr.approved') : t('appr.rejected'));
    }
    b.refresh();
  }

  const showApprovals = filter === 'needs you' || filter === 'all';

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
