import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown } from '@phosphor-icons/react';
import { useRepository } from '@/lib/repo';
import type { RunCoordination } from '@/lib/repo/types';
import { useI18n } from '@/i18n/I18nProvider';
import { presentTaskSteps } from '@/lib/task-presentation';

/** A narrow, permission-checked view of runtime evidence, never private tool arguments. */
export function TaskCoordination({ runId, live = false }: { runId: string; live?: boolean }) {
  const repo = useRepository();
  const { lang, t } = useI18n();
  const [data, setData] = useState<RunCoordination | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(340, innerWidth - 24);
      const height = panel.current?.offsetHeight ?? 0;
      setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 8, innerHeight - height - 12)) });
    }
    function outside(event: PointerEvent) {
      if (!button.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus(); }
    }
    place();
    if (document.activeElement === button.current) panel.current?.focus({ preventScroll: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (panel.current) observer?.observe(panel.current);
    if (button.current) observer?.observe(button.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, data, error]);
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
  if (!error && (!data || (!data.assignment && !data.events.length && !data.handoffs?.length))) return null;
  const role = data?.assignment?.kind === 'coordinator' ? t('handoff.coordinator')
    : data?.assignment?.role || t('handoff.specialist');
  const names = [...new Set((data?.handoffs ?? []).map((handoff) => handoff.name))];
  const label = names.length ? t('handoff.with', { role, names: names.join(', ') }) : role;
  const CODES = new Set(['unavailable', 'unknown_specialist', 'loop', 'limit_depth', 'limit_count', 'time', 'budget', 'failed', 'stopped']);
  const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <button ref={button} type="button" className="task-coordination-chip" aria-expanded={open}
        aria-controls={open ? panelId : undefined} aria-label={`${t('handoff.title')} · ${label}`}
        title={t('handoff.title')} onClick={() => setOpen(value => !value)}>
        <span>{label}</span><CaretDown size={12} aria-hidden="true" />
      </button>
      {open && createPortal(<div ref={panel} id={panelId} className="task-coordination task-coordination-popover"
        role="region" tabIndex={-1} aria-label={t('handoff.title')} style={position}>
      <strong>{t('handoff.title')}</strong>
      {error ? <><p>{t('handoff.unavailable')}</p><button type="button" className="ask-inline-action"
        onClick={() => setAttempt(n => n + 1)}>{t('loading.retry')}</button></> : data && <>
      {data.assignment && <p>{t('handoff.assigned', { role })}</p>}
      {data.handoffs?.length ? <ol className="task-coordination-handoffs" aria-label={t('handoff.specialists')}>
        {data.handoffs.map((handoff) => <li key={handoff.id}>
          <div className="task-coordination-handoff">
            <strong>{handoff.name}</strong>
            <span>{t(`handoff.outcome.${handoff.outcome}`)}</span>
            {handoff.code && CODES.has(handoff.code) && <span>{t(`handoff.code.${handoff.code}`)}</span>}
            <time dateTime={handoff.at}>{clock(handoff.at)}</time>
          </div>
          {handoff.steps.length > 0 && <ul>
            {presentTaskSteps(handoff.steps, lang, { advanced: false }).map((entry, index) => <li key={index}>
              {entry.label}{entry.subject ? ` · ${entry.subject}` : ''}{entry.count > 1 ? ` ×${entry.count}` : ''}
            </li>)}
          </ul>}
        </li>)}
      </ol> : null}
      <ol aria-label={t('handoff.history')}>
        {data.events.map(event => <li key={event.id}>
          <span>{t(`handoff.${event.stage}`)}</span>
          <time dateTime={event.at}>{clock(event.at)}</time>
        </li>)}
      </ol>
      <p className="text-text-muted">{t(data.events.length || data.handoffs?.length ? 'handoff.evidence' : 'handoff.none')}</p>
      </>}
      </div>, document.body)}
    </>
  );
}
