import { useEffect, useState } from 'react';
import { useRepository } from '@/lib/repo';
import type { RunCoordination } from '@/lib/repo/types';
import { useT } from '@/i18n/I18nProvider';

/** A narrow, permission-checked view of runtime evidence, never private tool arguments. */
export function TaskCoordination({ runId, live = false }: { runId: string; live?: boolean }) {
  const repo = useRepository();
  const t = useT();
  const [data, setData] = useState<RunCoordination | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(null); setError(false);
    if (!repo.runCoordination) return;
    async function read() {
      try {
        const next = await repo.runCoordination!(runId);
        if (active) { setData(next); setError(false); }
      } catch { if (active) { setData(null); setError(true); } }
      if (active && live) timer = setTimeout(() => void read(), 5000);
    }
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [repo, runId, live, attempt]);
  if (!repo.runCoordination) return null;
  if (error) return <div className="task-coordination"><p>{t('handoff.unavailable')}</p>
    <button type="button" className="ask-inline-action" onClick={() => setAttempt(n => n + 1)}>{t('loading.retry')}</button></div>;
  if (!data || (!data.assignment && !data.events.length)) return null;
  const role = data.assignment?.kind === 'coordinator' ? t('handoff.coordinator')
    : data.assignment?.role || t('handoff.specialist');
  return (
    <details className="task-coordination">
      <summary>{t('handoff.title')}{data.assignment && <span> · {role}</span>}
        {data.events.length > 0 && <span> · {t('handoff.count', { n: data.events.length })}</span>}
      </summary>
      {data.assignment && <p>{t('handoff.assigned', { role })}</p>}
      <ol aria-label={t('handoff.history')}>
        {data.events.map(event => <li key={event.id}>
          <span>{t(`handoff.${event.stage}`)}</span>
          <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </li>)}
      </ol>
      <p className="text-text-muted">{t(data.events.length ? 'handoff.evidence' : 'handoff.none')}</p>
    </details>
  );
}
