import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Code, FileText, MagnifyingGlass, ListBullets } from '@phosphor-icons/react';
import type { StepEntry } from '@/lib/task-presentation';
import { presentTaskSteps, safeTaskProgressLabel } from '@/lib/task-presentation';
import { useI18n } from '@/i18n/I18nProvider';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import { TypingBubble } from '@/components/WorkSignal';

function duration(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ActivityRow({ entry, bm }: { entry: StepEntry; bm: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const detail = useRef<HTMLSpanElement>(null);
  const detailId = useId();
  useEffect(() => {
    const element = detail.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [entry.subject, expanded]);
  const Icon = /Searching|research|Mencari|penyelidikan/i.test(entry.label) ? MagnifyingGlass
    : /Reading|file|Membaca|fail/i.test(entry.label) ? FileText
      : /command|code|arahan|kod/i.test(entry.label) ? Code : ListBullets;
  return <li className="ask-activity-row">
    <Icon size={15} className="ask-activity-icon" aria-hidden="true" />
    <div className="ask-step-content">
      <div className="ask-activity-heading">
        <span className="ask-step-label">{entry.label}</span>
        {entry.count > 1 && <span className="ask-activity-count" aria-label={`${entry.count} ${bm ? 'langkah' : 'steps'}`}>×{entry.count}</span>}
      </div>
      {entry.subject && <div className="ask-activity-detail">
        <span ref={detail} id={detailId} className={`ask-step-subject ask-activity-subject${expanded ? ' is-expanded' : ''}`}>{entry.subject}</span>
        {(overflows || entry.subject.length > 80) && <button type="button" className="ask-activity-expand" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>
          {expanded ? (bm ? 'Ringkaskan' : 'Show less') : (bm ? 'Lihat lagi' : 'Show more')}
        </button>}
      </div>}
    </div>
  </li>;
}

/** One current label and one flat history. Transport recovery is not activity. */
export function LiveTaskProgress({ steps, since, lastProgressAt, disconnected, connectionLabel, label, taskLabel, action }: {
  steps: string[]; since?: number; lastProgressAt?: number; disconnected?: boolean;
  connectionLabel?: string; durable: boolean; label?: string; taskLabel?: string;
  /** An action on the work in progress — Stop, today. It belongs beside the
      label and the clock, because that is the thing it acts on. Rendered
      after the history it read as one more step in the log. */
  action?: ReactNode;
}) {
  const { lang } = useI18n();
  const bm = lang === 'bm';
  const { advanced } = useDetailLevel();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const history = presentTaskSteps(steps, lang, { advanced });
  const latest = presentTaskSteps(steps, lang, { advanced: true }).at(-1);
  const quietFor = Math.max(0, Math.floor((now - (lastProgressAt ?? since ?? now)) / 1000));
  const quiet = quietFor >= 60;
  const active = !quiet && !disconnected;
  const currentLabel = disconnected
    ? connectionLabel || (bm ? 'Menyambung semula… Menyemak status tugasan.' : 'Reconnecting… Checking task status.')
    : quiet ? (bm ? 'Menunggu kemas kini' : 'Waiting for an update')
    : safeTaskProgressLabel(taskLabel) || latest?.label || label || (bm ? 'Menjalankan tugasan' : 'Working on your task');
  return <div className="min-w-0">
    {!latest ? <div className="ask-live-current">
      <TypingBubble label={currentLabel} since={since} active={active} />
      {action && <div className="ask-live-action">{action}</div>}
    </div> : <div className="ask-steps">
      <div className="ask-live-current">
        <div className="flex min-w-0 items-start gap-2">
          <span className={active ? 'ask-step-dot' : 'mt-2 h-2 w-2 shrink-0 rounded-full bg-text-muted'} aria-hidden="true" />
          <div className="ask-step-content">
            <span role="status" className={`ask-step-label${active ? ' ask-active-shimmer' : ''}`}>{currentLabel}</span>
            {since !== undefined && <span className="ask-step-meta tabular-nums">{duration(Math.max(0, Math.floor((now - since) / 1000)))}</span>}
          </div>
        </div>
        {action && <div className="ask-live-action">{action}</div>}
      </div>
    </div>}
    {quiet && !disconnected && <p className="mt-1 text-xs text-text-secondary">
      {bm ? `Tiada kemas kini baharu selama ${duration(quietFor)}.` : `No new progress update for ${duration(quietFor)}.`}
    </p>}
    {history.length > 0 && <details className="ask-step-history">
      <summary>{bm ? 'Lihat aktiviti' : 'View activity'} · {steps.length}</summary>
      <ol className="ask-steps ask-activity-list" aria-label={bm ? 'Aktiviti direkodkan' : 'Recorded activity'}>
        {history.map((entry, i) => <ActivityRow key={`${i}-${entry.label}`} entry={entry} bm={bm} />)}
      </ol>
    </details>}
  </div>;
}
