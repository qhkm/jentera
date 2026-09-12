import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { Desktop } from '@phosphor-icons/react';
import { useRepository, type RuntimeOverview } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { useT } from '@/i18n/I18nProvider';
import { computerStatus } from '@/lib/computer-status';

export function ComputerStatus({ onOpenChat, onOpenKnowledge, mobileTarget }: {
  onOpenChat?: () => void; onOpenKnowledge: () => void;
  mobileTarget?: HTMLElement | null;
}) {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const t = useT();
  const [data, setData] = useState<RuntimeOverview | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!disclosure.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      let delay = 5000;
      try {
        const next = await repo.runtimeStatus();
        if (!active) return;
        setData(next); setError(false);
        delay = ['ready', 'asleep', 'busy'].includes(computerStatus(next)) ? 30000 : 3000;
      } catch { if (active) { setData(null); setError(true); } }
      if (active) timer = setTimeout(() => { if (!document.hidden) void read(); }, delay);
    }
    const resume = () => { if (!document.hidden) setRefresh(n => n + 1); };
    void read();
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); };
  }, [repo, signedIn, refresh]);
  if (!signedIn) return null;
  const state = error ? 'unknown' : data ? computerStatus(data) : 'checking';
  const compact = ['ready', 'asleep', 'busy'].includes(state);
  const manage = data?.canManage === true;
  const mobileQuiet = ['ready', 'asleep', 'busy', 'checking', 'waking', 'updating'].includes(state);
  const content = <>
      <Desktop size={18} aria-hidden="true" />
      <div className="computer-status-copy">
        <div role="status"><span>{t('computer.title')}</span><strong>{t(`computer.${state}`)}</strong></div>
        {!compact && <p>{t(`computer.${state}.detail`)}</p>}
        {!compact && !manage && ['missing', 'attention'].includes(state) && <p>{t('computer.owner')}</p>}
      </div>
      <div className="computer-status-actions">
        {manage && ['missing', 'attention'].includes(state) && <Link to="/setup" className="btn btn-outline">
          {t(state === 'missing' ? 'computer.setup' : 'computer.review')}
        </Link>}
        {['settingUp', 'updating', 'waking'].includes(state) && <button type="button" className="ask-inline-action" onClick={onOpenKnowledge}>{t('computer.knowledge')}</button>}
        {compact && onOpenChat && <button type="button" className="ask-inline-action" onClick={onOpenChat}>{t('computer.job')}</button>}
        {['unknown', 'attention'].includes(state) && <button type="button" className="ask-inline-action" onClick={() => setRefresh(n => n + 1)}>{t('computer.refresh')}</button>}
      </div>
  </>;
  return <>
    <section className={`computer-status ${compact ? 'computer-status-compact' : ''} ${mobileTarget && mobileQuiet ? 'computer-status-mobile-hidden' : ''}`} aria-label={t('computer.title')}>
      {content}
    </section>
    {mobileTarget && createPortal(<div ref={disclosure} className="computer-status-disclosure">
      <button ref={trigger} type="button" className="computer-status-trigger" data-state={state}
        aria-label={`${t('computer.title')} · ${t(`computer.${state}`)}`}
        aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
        <Desktop size={18} aria-hidden="true" /><span className="computer-status-dot" aria-hidden="true" />
      </button>
      {open && <div id={panelId} className="computer-status-popover" role="region" aria-label={t('computer.title')}>
        {content}
      </div>}
    </div>, mobileTarget)}
  </>;
}
