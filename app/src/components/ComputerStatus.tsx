import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { Desktop } from '@phosphor-icons/react';
import { useRepository, type RuntimeOverview } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { useT } from '@/i18n/I18nProvider';
import { computerStatus } from '@/lib/computer-status';
import { ComputerSetupProgress } from './ComputerSetupProgress';
import { JenteraMark } from './JenteraMark';

export function ComputerStatus({ onOpenChat, onOpenKnowledge, onOpenActivity, mobileTarget }: {
  onOpenChat?: () => void; onOpenKnowledge: () => void;
  onOpenActivity?: (runId?: string, title?: string) => void;
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
        delay = next.activeWork ? 5000
          : ['ready', 'asleep', 'busy'].includes(computerStatus(next)) ? 30000 : 3000;
      } catch { if (active) { setData(null); setError(true); } }
      if (active) timer = setTimeout(() => { if (!document.hidden) void read(); }, delay);
    }
    const resume = () => { if (!document.hidden) setRefresh(n => n + 1); };
    void read();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('jentera:work-change', resume);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('jentera:work-change', resume);
    };
  }, [repo, signedIn, refresh]);
  if (!signedIn) return null;
  const state = error ? 'unknown' : data ? computerStatus(data) : 'checking';
  const activeWork = error ? null : data?.activeWork ?? null;
  const compact = Boolean(activeWork) || ['ready', 'asleep', 'busy'].includes(state);
  const manage = data?.canManage === true;
  const headerOnly = Boolean(activeWork) || ['ready', 'asleep', 'busy', 'checking', 'waking', 'updating'].includes(state);
  const settingUp = ['settingUp', 'updating'].includes(state);
  const workState = activeWork?.status === 'needs_approval' ? 'needsApproval'
    : activeWork?.status === 'queued' ? 'queued' : 'working';
  const title = activeWork ? t('workStatus.title') : t('computer.title');
  const status = activeWork ? t(`workStatus.${workState}`) : t(`computer.${state}`);
  const openActivity = () => {
    setOpen(false);
    if (activeWork) onOpenActivity?.(activeWork.runId, activeWork.objective);
  };
  const content = <>
      {activeWork ? <JenteraMark size={22} /> : <Desktop size={18} aria-hidden="true" />}
      <div className="computer-status-copy">
        <div role="status"><span>{title}</span><strong>{status}</strong></div>
        {activeWork ? <>
          <p className="computer-status-objective">{activeWork.objective}</p>
          {activeWork.count > 1 && <p>{t('workStatus.more', { n: activeWork.count - 1 })}</p>}
        </> : <>
          {!compact && <p>{t(`computer.${state}.detail`)}</p>}
          {settingUp && data?.setupProgress && <ComputerSetupProgress progress={data.setupProgress} />}
          {!compact && !manage && ['missing', 'attention'].includes(state) && <p>{t('computer.owner')}</p>}
        </>}
      </div>
      <div className="computer-status-actions">
        {activeWork && onOpenActivity && <button type="button" className="ask-inline-action" onClick={openActivity}>{t('workStatus.open')}</button>}
        {!activeWork && manage && ['missing', 'attention'].includes(state) && <Link to="/setup" className="btn btn-outline">
          {t(state === 'missing' ? 'computer.setup' : 'computer.review')}
        </Link>}
        {!activeWork && ['settingUp', 'updating', 'waking'].includes(state) && <button type="button" className="ask-inline-action" onClick={onOpenKnowledge}>{t('computer.knowledge')}</button>}
        {!activeWork && compact && onOpenChat && <button type="button" className="ask-inline-action" onClick={onOpenChat}>{t('computer.job')}</button>}
        {!activeWork && ['unknown', 'attention'].includes(state) && <button type="button" className="ask-inline-action" onClick={() => setRefresh(n => n + 1)}>{t('computer.refresh')}</button>}
      </div>
  </>;
  return <>
    <section className={`computer-status ${settingUp ? 'computer-status-setup' : ''} ${activeWork ? 'computer-status-active' : ''} ${compact ? 'computer-status-compact' : ''} ${mobileTarget && headerOnly ? 'computer-status-header-hidden' : ''}`} aria-label={title}>
      {content}
    </section>
    {mobileTarget && createPortal(<div ref={disclosure} className="computer-status-disclosure">
      <button ref={trigger} type="button" className="computer-status-trigger" data-state={activeWork?.status ?? state}
        aria-label={`${title} · ${status}${activeWork ? ` · ${activeWork.objective}` : ''}`}
        aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
        {activeWork ? <JenteraMark size={22} /> : <Desktop size={18} aria-hidden="true" />}
        <span className="computer-status-dot" aria-hidden="true" />
      </button>
      {open && <div id={panelId} className={`computer-status-popover ${settingUp ? 'computer-status-setup' : ''} ${activeWork ? 'computer-status-active' : ''}`} role="region" aria-label={title}>
        {content}
      </div>}
    </div>, mobileTarget)}
  </>;
}
