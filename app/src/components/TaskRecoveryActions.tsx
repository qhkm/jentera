import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowClockwise } from '@phosphor-icons/react';
import { useRepository } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { useT } from '@/i18n/I18nProvider';
import { isRunId, taskDisplayTitle } from '@/lib/task';
import { checkTaskRecovery, type TaskRecoveryRequest, type TaskRecoveryStatus } from '@/lib/task-recovery';

/** Explicit, bounded reads followed by a REVIEWABLE draft. Never auto-send,
 * claim/release the browser, approve an action, or replay the original request. */
export function TaskRecoveryActions({ runId, request, title, onContinue }: {
  runId: string;
  request: TaskRecoveryRequest;
  title?: string;
  onContinue: (context: string, sessionId?: string) => void;
}) {
  const repo = useRepository();
  const signedIn = useSignedIn();
  const t = useT();
  const [status, setStatus] = useState<TaskRecoveryStatus | 'idle' | 'checking'>('idle');
  const generation = useRef(0);
  const flight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current++;
    clearTimeout(timer.current);
    controller.current?.abort();
    flight.current = false;
    setStatus('idle');
    return () => { generation.current++; flight.current = false; clearTimeout(timer.current); controller.current?.abort(); };
  }, [repo, runId, request, signedIn]);

  if (!signedIn || !isRunId(runId)) return null;

  async function check(prepare = false) {
    if (flight.current) return;
    flight.current = true;
    const current = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setStatus('checking');
    timer.current = setTimeout(() => {
      if (generation.current !== current) return;
      generation.current++;
      controller.current?.abort();
      flight.current = false;
      setStatus('unavailable');
    }, 15_000);
    try {
      const next = await checkTaskRecovery(repo, runId, request, controller.current.signal);
      if (generation.current !== current) return;
      setStatus(next.status);
      if (prepare && next.status === 'ready') {
        onContinue(t('task.recovery.context', { title: taskDisplayTitle(title || t('task.title')) })
          + '\n\n' + t(request === 'input' ? 'task.recovery.inputPrompt' : 'task.recovery.verifyPrompt'), next.sessionId);
      }
    } catch {
      // No raw provider/runtime errors (which may contain URLs or secrets).
      if (generation.current === current) setStatus('unavailable');
    } finally {
      if (generation.current === current) { clearTimeout(timer.current); flight.current = false; }
    }
  }

  const ready = status === 'ready';
  const statusKey = ready
    ? request === 'input' ? 'task.recovery.readyInput' : request === 'google_calendar' ? 'task.recovery.readyCalendar' : 'task.recovery.readyBrowser'
    : status === 'idle' && request === 'input' ? 'task.recovery.idleInput' : `task.recovery.${status}`;
  return <div className="task-recovery-actions" aria-busy={status === 'checking'}>
    <p role="status">{t(statusKey)}</p>
    <div>
      {ready && <button type="button" className="btn btn-primary" onClick={() => void check(true)}>
        {t('task.recovery.continue')}<ArrowRight size={17} aria-hidden="true" />
      </button>}
      <button type="button" className={`btn ${ready ? 'btn-ghost' : 'btn-outline'}`} disabled={status === 'checking'} onClick={() => void check()}>
        <ArrowClockwise size={17} aria-hidden="true" />
        {t(status === 'checking' ? 'task.recovery.checking' : status === 'idle' ? 'task.recovery.check' : 'task.recovery.checkAgain')}
      </button>
    </div>
    {ready && <small>{t('task.recovery.draftOnly')}</small>}
  </div>;
}
