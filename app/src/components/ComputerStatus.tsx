import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Desktop } from '@phosphor-icons/react';
import { useRepository, type RuntimeOverview } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { useT } from '@/i18n/I18nProvider';
import { computerStatus } from '@/lib/computer-status';

export function ComputerStatus({ onOpenChat, onOpenKnowledge }: {
  onOpenChat?: () => void; onOpenKnowledge: () => void;
}) {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const t = useT();
  const [data, setData] = useState<RuntimeOverview | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
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
  return (
    <section className={`computer-status ${compact ? 'computer-status-compact' : ''}`} aria-label={t('computer.title')}>
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
    </section>
  );
}
