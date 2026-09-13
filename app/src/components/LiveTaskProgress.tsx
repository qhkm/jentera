import { useEffect, useState } from 'react';
import { presentTaskSteps } from '@/lib/task-presentation';
import { useI18n } from '@/i18n/I18nProvider';

function duration(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Elapsed time is not a heartbeat. Quiet work is explicitly unconfirmed. */
export function LiveTaskProgress({ steps, since, lastProgressAt, disconnected, durable }: {
  steps: string[]; since?: number; lastProgressAt?: number; disconnected?: boolean; durable: boolean;
}) {
  const { lang } = useI18n();
  const bm = lang === 'bm';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const entries = presentTaskSteps(steps, lang, { advanced: true });
  const current = entries.at(-1);
  const tool = current?.subject === 'codex' ? 'Codex' : current?.subject === 'claude' ? 'Claude' : undefined;
  const quietFor = Math.max(0, Math.floor((now - (lastProgressAt ?? since ?? now)) / 1000));
  const quiet = quietFor >= 60;
  const label = disconnected ? (bm ? 'Menyambung semula…' : 'Reconnecting…')
    : quiet ? (bm ? 'Menunggu kemas kini' : 'Waiting for an update')
      : tool ? (bm ? `Menjalankan tugasan dengan ${tool}` : `Working with ${tool}`)
        : current?.label ?? (bm ? 'Menjalankan tugasan' : 'Working on your task');
  return <div className="mt-3 min-w-0 rounded-xl border border-border p-3">
    <div className="flex min-w-0 items-center gap-2">
      <span className={quiet || disconnected ? 'h-2 w-2 shrink-0 rounded-full bg-text-muted' : 'ask-step-dot'} aria-hidden="true" />
      <span className="min-w-0 text-sm font-medium" role="status">{label}</span>
      {since !== undefined && <span className="ml-auto shrink-0 text-xs tabular-nums text-text-muted">{duration(Math.max(0, Math.floor((now - since) / 1000)))}</span>}
    </div>
    <p className="mt-2 text-xs text-text-secondary">
      {disconnected ? (bm ? 'Sedang menyemak hasil yang disimpan. Jangan hantar semula dahulu.' : 'Checking the saved result. Please don’t resend yet.')
        : quiet ? (bm ? `Tiada kemas kini baharu selama ${duration(quietFor)}. Tugasan mungkin masih berjalan.` : `No new progress update for ${duration(quietFor)}. The task may still be running.`)
          : (bm ? 'Kemas kini akan dipaparkan apabila tersedia.' : 'Progress updates will appear here when available.')}
    </p>
    {durable && <p className="mt-1 text-xs text-text-muted">{bm ? 'Anda boleh tinggalkan chat ini dan kembali untuk menyemak hasil.' : 'You can leave this chat and return to check the result.'}</p>}
    {entries.length > 0 && <details className="mt-3 text-xs text-text-secondary">
      <summary className="cursor-pointer py-1">{bm ? 'Butiran teknikal' : 'Technical details'} · {entries.length} {bm ? 'langkah' : entries.length === 1 ? 'step' : 'steps'}</summary>
      <ol className="mt-2 space-y-1">{entries.map((entry, i) => <li key={i}>{entry.label}{entry.subject ? ` · ${entry.subject}` : ''}</li>)}</ol>
    </details>}
  </div>;
}
