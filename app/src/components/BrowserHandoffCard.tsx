import { ArrowUpRight, Desktop } from '@phosphor-icons/react';
import { useT } from '@/i18n/I18nProvider';
import type { BrowserHandoffReason } from '@/lib/browser-handoff';
import { TaskRecoveryActions } from '@/components/TaskRecoveryActions';
import { useSignedIn } from '@/lib/repo/gate';

export function BrowserHandoffCard({ reason, onOpen, runId, title: taskTitle, onContinue }: {
  reason: BrowserHandoffReason;
  onOpen: () => void;
  runId?: string;
  title?: string;
  onContinue?: (context: string, sessionId?: string) => void;
}) {
  const t = useT();
  const canRecover = useSignedIn() && Boolean(runId && onContinue);
  const title = t(`ask.browserHandoff.title.${reason}`);
  return (
    <section className="card ask-browser-handoff" aria-label={title}>
      <header>
        <span className="ask-browser-handoff-icon" aria-hidden="true"><Desktop size={22} weight="duotone" /></span>
        <div>
          <p>{t('browser.title')}</p>
          <h3>{title}</h3>
        </div>
      </header>
      <p className="ask-browser-handoff-detail">{t(`ask.browserHandoff.detail.${reason}`)}</p>
      <button type="button" className="btn btn-primary" onClick={onOpen}>
        {t('browser.open')}
        <ArrowUpRight size={17} aria-hidden="true" />
      </button>
      <p className="ask-browser-handoff-note">{t(canRecover ? 'task.recovery.handBack' : 'ask.browserHandoff.handBack')}</p>
      {runId && onContinue && <TaskRecoveryActions runId={runId} request={reason} title={taskTitle} onContinue={onContinue} />}
      <small>{t('ask.browserHandoff.private')}</small>
    </section>
  );
}
