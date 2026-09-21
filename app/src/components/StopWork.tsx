import { useState } from 'react';
import { XCircle } from '@phosphor-icons/react';
import { useRepository } from '@/lib/repo';
import { useT } from '@/i18n/I18nProvider';
import { isRunId } from '@/lib/task';

/** Stop a reply that will not finish.
 *
 * A run that wedges — an agent waiting on a browser the owner still holds,
 * a tool that never returns — showed a timer and nothing else until the
 * runner expired it five minutes later. The control plane could always stop
 * it; nothing asked.
 *
 * Rendered only where the repository can actually cancel, because a Stop
 * that does nothing is worse than no Stop: the owner presses it, the timer
 * keeps counting, and they learn the product lies.
 */
export function StopWork({ runId }: { runId?: string }) {
  const repo = useRepository();
  const t = useT();
  const [state, setState] = useState<'idle' | 'stopping' | 'failed'>('idle');
  if (!isRunId(runId) || !repo.cancelRun) return null;
  if (state === 'stopping') return <div className="stop-work"><p className="task-recovery-note" role="status">{t('ask.stopping')}</p></div>;
  return (
    <div className="stop-work">
      <button
        type="button"
        className="ask-inline-action"
        onClick={async () => {
          setState('stopping');
          /* The run's own stream reports the cancellation, so nothing is
             assumed here: a failure puts the control back rather than
             leaving a stopped-looking reply that is still running. */
          try { await repo.cancelRun!(runId!); } catch { setState('failed'); }
        }}
      >
        <XCircle size={15} aria-hidden="true" />
        {t('ask.stop')}
      </button>
      {state === 'failed' && <p className="task-recovery-note" role="alert">{t('ask.stop.failed')}</p>}
    </div>
  );
}
