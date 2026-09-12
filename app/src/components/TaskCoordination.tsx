import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown } from '@phosphor-icons/react';
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
  if (!error && (!data || (!data.assignment && !data.events.length))) return null;
  const role = data?.assignment?.kind === 'coordinator' ? t('handoff.coordinator')
    : data?.assignment?.role || t('handoff.specialist');
  return (
    <>
      <button ref={button} type="button" className="task-coordination-chip" aria-expanded={open}
        aria-controls={open ? panelId : undefined} aria-label={`${t('handoff.title')} · ${role}`}
        title={t('handoff.title')} onClick={() => setOpen(value => !value)}>
        <span>{role}</span><CaretDown size={12} aria-hidden="true" />
      </button>
      {open && createPortal(<div ref={panel} id={panelId} className="task-coordination task-coordination-popover"
        role="region" tabIndex={-1} aria-label={t('handoff.title')} style={position}>
      <strong>{t('handoff.title')}</strong>
      {error ? <><p>{t('handoff.unavailable')}</p><button type="button" className="ask-inline-action"
        onClick={() => setAttempt(n => n + 1)}>{t('loading.retry')}</button></> : data && <>
      {data.assignment && <p>{t('handoff.assigned', { role })}</p>}
      <ol aria-label={t('handoff.history')}>
        {data.events.map(event => <li key={event.id}>
          <span>{t(`handoff.${event.stage}`)}</span>
          <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </li>)}
      </ol>
      <p className="text-text-muted">{t(data.events.length ? 'handoff.evidence' : 'handoff.none')}</p>
      </>}
      </div>, document.body)}
    </>
  );
}
