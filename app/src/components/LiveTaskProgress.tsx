import { useEffect, useState } from 'react';
import { presentTaskSteps, safeTaskProgressLabel } from '@/lib/task-presentation';
import { useI18n } from '@/i18n/I18nProvider';
import { Check } from '@phosphor-icons/react';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import { TypingBubble } from '@/components/WorkSignal';

function duration(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Elapsed time is not a heartbeat. Quiet work is explicitly unconfirmed. */
export function LiveTaskProgress({ steps, since, lastProgressAt, disconnected, label, taskLabel }: {
  steps: string[]; since?: number; lastProgressAt?: number; disconnected?: boolean; durable: boolean; label?: string; taskLabel?: string;
}) {
  const { lang } = useI18n();
  const bm = lang === 'bm';
  const { advanced } = useDetailLevel();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const completed = presentTaskSteps(steps.slice(0, -1), lang, { advanced });
  const latest = presentTaskSteps(steps, lang, { advanced: true }).at(-1);
  const entries = latest ? [latest] : [];
  const quietFor = Math.max(0, Math.floor((now - (lastProgressAt ?? since ?? now)) / 1000));
  const quiet = quietFor >= 60;
  const purpose = !quiet && !disconnected ? safeTaskProgressLabel(taskLabel) : undefined;
  const hasSteps = entries.length > 0;
  if (!entries.length) entries.push({ label: disconnected
    ? (bm ? 'Menyemak status tugasan' : 'Checking task status')
    : quiet ? (bm ? 'Menunggu kemas kini' : 'Waiting for an update')
    : label || (bm ? 'Menjalankan tugasan' : 'Working on your task'), count: 1 });
  return <div className="min-w-0">
    {completed.length > 0 && <details className="ask-step-history">
      <summary>{steps.length - 1} {bm ? 'langkah selesai' : `step${steps.length === 2 ? '' : 's'} completed`}</summary>
      <ol className="ask-steps" aria-label={bm ? 'Langkah selesai' : 'Completed steps'}>
        {completed.map((entry, i) => <li key={`${i}-${entry.label}`}>
          <Check size={13} aria-hidden="true" className="ask-step-done" />
          <div className="ask-step-content">
            <span className="ask-step-label">{entry.label}</span>
            {entry.subject && <span className="ask-step-subject">{entry.subject}</span>}
            {entry.count > 1 && <span className="ask-step-meta">{entry.count} {bm ? 'langkah' : 'steps'}</span>}
          </div>
        </li>)}
      </ol>
    </details>}
    {!hasSteps ? <TypingBubble label={entries[0].label} since={since} active={!quiet && !disconnected} /> : <ol className="ask-steps" aria-label="Steps">
      {entries.map((entry, i) => {
        const current = i === entries.length - 1;
        return <li key={`${i}-${entry.label}`} aria-current={current ? 'step' : undefined}>
          {current ? <span className={quiet || disconnected ? 'mt-2 h-2 w-2 shrink-0 rounded-full bg-text-muted' : 'ask-step-dot'} aria-hidden="true" /> : <Check size={13} aria-hidden="true" className="ask-step-done" />}
          <div className="ask-step-content">
            <span className={`ask-step-label${current && !quiet && !disconnected ? ' ask-active-shimmer' : ''}`}>{disconnected ? (bm ? 'Menyemak status tugasan' : 'Checking task status') : quiet ? (bm ? 'Menunggu kemas kini' : 'Waiting for an update') : purpose || entry.label}</span>
            {purpose ? <details className="ask-step-history"><summary>{bm ? 'Butiran teknikal' : 'Technical details'}</summary><span className="ask-step-subject">{entry.label}{entry.subject ? ` · ${entry.subject}` : ''}</span></details>
              : entry.subject && <span className="ask-step-subject">{entry.subject}</span>}
            {(entry.count > 1 || current) && <div className="ask-step-meta">
              {entry.count > 1 && <span className="ask-step-count">{entry.count} {bm ? 'langkah' : 'steps'}</span>}
              {current && since !== undefined && <span className="text-text-tertiary tabular-nums">{entry.count > 1 ? ' · ' : ''}{duration(Math.max(0, Math.floor((now - since) / 1000)))}</span>}
            </div>}
          </div>
        </li>;
      })}
    </ol>}
    {(quiet || disconnected) && <p className="mt-1 text-xs text-text-secondary" role="status">
      {disconnected ? (bm ? 'Menyambung semula… Sedang menyemak hasil yang disimpan.' : 'Reconnecting… Checking the saved result.')
        : (bm ? `Menunggu kemas kini · ${duration(quietFor)} tanpa kemas kini baharu.` : `Waiting for an update · No new progress update for ${duration(quietFor)}.`)}
    </p>}
  </div>;
}
