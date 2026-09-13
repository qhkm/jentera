import { useEffect, useState } from 'react';
import { presentTaskSteps, safeTaskProgressLabel } from '@/lib/task-presentation';
import { useI18n } from '@/i18n/I18nProvider';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import { TypingBubble } from '@/components/WorkSignal';

function duration(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** One current label and one flat history. Transport recovery is not activity. */
export function LiveTaskProgress({ steps, since, lastProgressAt, disconnected, connectionLabel, label, taskLabel }: {
  steps: string[]; since?: number; lastProgressAt?: number; disconnected?: boolean;
  connectionLabel?: string; durable: boolean; label?: string; taskLabel?: string;
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
    {!latest ? <TypingBubble label={currentLabel} since={since} active={active} /> : <div className="ask-steps">
      <div className="flex min-w-0 items-start gap-2">
        <span className={active ? 'ask-step-dot' : 'mt-2 h-2 w-2 shrink-0 rounded-full bg-text-muted'} aria-hidden="true" />
        <div className="ask-step-content">
          <span role="status" className={`ask-step-label${active ? ' ask-active-shimmer' : ''}`}>{currentLabel}</span>
          {since !== undefined && <span className="ask-step-meta tabular-nums">{duration(Math.max(0, Math.floor((now - since) / 1000)))}</span>}
        </div>
      </div>
    </div>}
    {quiet && !disconnected && <p className="mt-1 text-xs text-text-secondary">
      {bm ? `Tiada kemas kini baharu selama ${duration(quietFor)}.` : `No new progress update for ${duration(quietFor)}.`}
    </p>}
    {history.length > 0 && <details className="ask-step-history">
      <summary>{bm ? 'Lihat aktiviti' : 'View activity'} · {steps.length}</summary>
      <ol className="ask-steps" aria-label={bm ? 'Aktiviti direkodkan' : 'Recorded activity'}>
        {history.map((entry, i) => <li key={`${i}-${entry.label}`}>
          <div className="ask-step-content">
            <span className="ask-step-label">{entry.label}</span>
            {entry.subject && <span className="ask-step-subject">{entry.subject}</span>}
            {entry.count > 1 && <span className="ask-step-meta">{entry.count} {bm ? 'langkah' : 'steps'}</span>}
          </div>
        </li>)}
      </ol>
    </details>}
  </div>;
}
