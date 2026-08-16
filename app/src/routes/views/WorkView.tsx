/* ============================================================
   Work — decisions that need you, and what the AI already handled.
   Filter tabs default to "needs you", because that is the only
   category the user has to act on.
   ============================================================ */

import { useMemo, useState } from 'react';
import { Avatar, Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useT } from '@/i18n/I18nProvider';
import { useToast } from '@/components/Toast';
import type { Business, Tone, WorkItem } from '@/lib/types';

export type WorkFilter = 'needs you' | 'auto' | 'done' | 'all';

function toneFor(tc: string): Tone {
  return tc === 'green' || tc === 'red' || tc === 'amber' ? tc : 'neutral';
}

export default function WorkView({
  business,
  workDone,
  onApprove,
}: {
  business: Business;
  workDone: (i: number) => boolean;
  onApprove: (i: number) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [filter, setFilter] = useState<WorkFilter>('needs you');

  /** Index alongside the item — filtering must not lose the original position. */
  const indexed = useMemo(
    () => business.work.map((w, i) => ({ w, i })),
    [business.work],
  );

  const counts = useMemo(() => {
    let need = 0;
    let auto = 0;
    let done = 0;
    indexed.forEach(({ w, i }) => {
      if (workDone(i)) done += 1;
      else if (w.tag === 'needs you') need += 1;
      else auto += 1;
    });
    return { need, auto, done, all: business.work.length };
  }, [indexed, workDone, business.work.length]);

  const shown = useMemo(
    () =>
      indexed.filter(({ w, i }) => {
        if (filter === 'all') return true;
        if (filter === 'done') return workDone(i);
        if (filter === 'needs you') return !workDone(i) && w.tag === 'needs you';
        return !workDone(i) && w.tag !== 'needs you';
      }),
    [indexed, filter, workDone],
  );

  const TABS: { id: WorkFilter; labelKey: string; count: number }[] = [
    { id: 'needs you', labelKey: 'work.f.need', count: counts.need },
    { id: 'auto', labelKey: 'work.f.auto', count: counts.auto },
    { id: 'done', labelKey: 'work.f.done', count: counts.done },
    { id: 'all', labelKey: 'work.f.all', count: counts.all },
  ];

  function approve(item: WorkItem, i: number) {
    onApprove(i);
    toast(item.cta ?? t('toast.approved'));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-pixel text-2xl tracking-tight">{t('view.work')}</h1>
        <p className="max-w-[66ch] text-sm text-text-secondary">{t('view.work.desc')}</p>
      </header>

      {/* Summary — what needs you reads first */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-1">
          <Eyebrow>{t('work.need')}</Eyebrow>
          <span
            className={`font-pixel text-2xl tabular-nums ${counts.need ? 'text-[rgb(255_200_90)]' : ''}`}
          >
            {counts.need}
          </span>
        </Card>
        <Card className="gap-1">
          <Eyebrow>{t('work.auto')}</Eyebrow>
          <span className="font-pixel text-2xl tabular-nums">{counts.done}</span>
        </Card>
        <Card className="gap-1">
          <Eyebrow>{t('work.activity')}</Eyebrow>
          <span className="font-pixel text-2xl tabular-nums">{counts.auto + counts.done}</span>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter work items">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            role="tab"
            aria-selected={filter === tab.id}
            variant={filter === tab.id ? 'primary' : 'outline'}
            className="px-4 py-1.5 text-xs"
            onClick={() => setFilter(tab.id)}
          >
            {t(tab.labelKey)} · {tab.count}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <p className="text-[13px] text-text-muted">
            Nothing in this category — it's all settled. 🎉
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map(({ w, i }) => {
            const approved = workDone(i);
            const needsYou = !approved && w.tag === 'needs you';
            return (
              <Card key={`${w.n}-${i}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar>{w.e}</Avatar>
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
                      Approve &amp; send
                    </Button>
                    <Button
                      variant="outline"
                      className="px-4 py-1.5 text-xs"
                      onClick={() => toast('Opening the draft for editing…')}
                    >
                      Edit
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
