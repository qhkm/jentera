import { useEffect, useRef, useState } from 'react';
import { ArtifactList } from '@/components/ArtifactList';
import { ArrowLeft, ArrowUpRight, ChatCircle, CheckCircle, Clock, WarningCircle } from '@phosphor-icons/react';
import { Button, Card, Eyebrow, LoadingState, Tag } from '@/components/ui';
import { JenteraMark } from '@/components/JenteraMark';
import { useRepository, type RunResult, type WorkSummary } from '@/lib/repo';
import { useT } from '@/i18n/I18nProvider';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import { isRunId } from '@/lib/task';
import type { Tone } from '@/lib/types';
import RunTrace from './RunTrace';
import { RuntimeApprovalCard } from '@/components/RuntimeApprovalCard';
import { useActivity } from '@/hooks/useActivity';
import { TaskCoordination } from '@/components/TaskCoordination';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'task.queued', tone: 'neutral' },
  running: { label: 'work.inprogress', tone: 'neutral' },
  working: { label: 'work.inprogress', tone: 'neutral' },
  needs_approval: { label: 'work.waiting', tone: 'amber' },
  needs_input: { label: 'task.needsInput', tone: 'amber' },
  needs_review: { label: 'task.needsReview', tone: 'amber' },
  blocked: { label: 'work.blocked', tone: 'amber' },
  completed: { label: 'work.done', tone: 'green' },
  failed: { label: 'work.failed', tone: 'red' },
  cancelled: { label: 'task.cancelled', tone: 'neutral' },
};

/** Fetch by run ID even when the task has fallen out of the recent Activity list.
 * A missing/forbidden run never falls back to a locally cached result. */
export default function TaskDetailView({ runId, title, work, onBack, onOpenAsk, reviewOnly = false }: {
  runId: string;
  reviewOnly?: boolean;
  title?: string;
  work?: WorkSummary;
  onBack?: () => void;
  onOpenAsk?: (context?: string, sessionId?: string) => void;
}) {
  const t = useT();
  const repo = useRepository();
  const detail = useDetailLevel();
  const activity = useActivity();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [traceOpen, setTraceOpen] = useState(false);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult(null);
    setError(false);
    async function read() {
      try {
        if (!isRunId(runId)) throw new Error('Invalid task link');
        if (reviewOnly && !repo.taskReviewSummary) throw new Error('Review is unavailable');
        const next = reviewOnly ? await repo.taskReviewSummary!(runId) : await repo.runResult(runId);
        if (!live) return;
        setResult(next);
        if (next.pending && !['completed', 'failed', 'cancelled'].includes(next.status)) {
          timer = setTimeout(() => void read(), 3000);
        }
      } catch {
        if (live) {
          setResult(null);
          setError(true);
        }
      }
    }
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [repo, runId, attempt, reviewOnly]);

  const outcomeStatus = result?.taskStatus ?? result?.status;
  const status = outcomeStatus ? STATUS[outcomeStatus] : undefined;
  const completed = outcomeStatus === 'completed';
  const waiting = outcomeStatus === 'needs_approval';
  const failed = result?.status === 'failed' || result?.status === 'cancelled';
  const StatusIcon = completed ? CheckCircle : failed ? WarningCircle : Clock;
  const fullText = typeof result?.text === 'string' ? result.text.trim() : '';
  const summary = completed && !fullText ? work?.outcome : null;
  const needsReview = outcomeStatus === 'needs_review';
  const needsInput = outcomeStatus === 'needs_input' || outcomeStatus === 'blocked';
  function continueTask() {
    const taskTitle = (work?.objective || title || runId).slice(0, 120);
    const excerpt = fullText.length > 300 ? `${fullText.slice(0, 300)}…` : fullText;
    onOpenAsk?.(t('task.feedbackContext', { title: taskTitle }) + '\n\n' + excerpt + '\n\n' + t('task.feedbackPrompt'), result?.sessionId);
  }
  async function settle(decision: 'confirm' | 'dismiss') {
    setReviewBusy(true);
    setReviewError(null);
    try {
      if (decision === 'confirm') await repo.confirmTaskReview?.(runId);
      else await repo.dismissTask?.(runId);
      activity.reload();
      setAttempt((n) => n + 1);
    } catch (e) { setReviewError(e instanceof Error ? e.message : t('task.reviewError')); }
    finally { setReviewBusy(false); }
  }
  return (
    <section className="task-detail" aria-labelledby="task-heading">
      <nav className="task-detail-nav" aria-label={t('task.navigation')}>
        {onBack && <button type="button" className="ask-inline-action" onClick={onBack}>
          <ArrowLeft size={17} aria-hidden="true" />{t('task.allActivity')}
        </button>}
        {onOpenAsk && <button type="button" className="ask-inline-action" onClick={() => onOpenAsk()}>
          <ChatCircle size={17} aria-hidden="true" />{t('task.backToChat')}
        </button>}
      </nav>
      <header className="task-detail-heading">
        <Eyebrow>{t('task.title')}</Eyebrow>
        <h1 id="task-heading" tabIndex={-1} ref={heading}>{result ? result.objective || work?.objective || title || t('task.title') : t('task.title')}</h1>
      </header>
      {error ? (
        <Card className="gap-4" role="alert">
          <WarningCircle size={24} aria-hidden="true" />
          <p>{t('task.unavailable')}</p>
          <div><Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t('loading.retry')}</Button></div>
        </Card>
      ) : !result ? (
        <Card><LoadingState title={t('task.loading')} /></Card>
      ) : (
        <>
          {result.summaryOnly && <Card><p>{t('task.sharedReviewNote')}</p></Card>}
          {!reviewOnly && !result.summaryOnly && <TaskCoordination key={runId} runId={runId} live={result.pending} />}
          <div className="task-status-bar" role="status">
            <span><StatusIcon size={21} aria-hidden="true" /><strong>{t(status?.label ?? 'task.unknown')}</strong></span>
            <Tag tone={status?.tone ?? 'neutral'}>{t('task.card.label')}</Tag>
          </div>
          {completed || (result.status === 'completed' && fullText) ? (
            <Card className="task-result">
              <header><JenteraMark size={28} /><h2>{t(summary || result.summaryOnly ? 'task.summary' : 'task.result')}</h2></header>
              {outcomeStatus === 'needs_input' && <p>{t('task.needsInputNote')}</p>}
              {outcomeStatus === 'needs_review' && <p>{t('task.needsReviewNote')}</p>}
              <div className="task-result-text">{fullText || summary || t('task.noResult')}</div>
            </Card>
          ) : (
            <Card className="task-result gap-4">
              <p>{failed
                ? (typeof result.err === 'string' && result.err) || t(result.status === 'cancelled' ? 'task.cancelledNote' : 'task.failedNote')
                : t(waiting ? 'task.approvalNote' : outcomeStatus === 'cancelled' ? 'task.cancelledNote' : result.status === 'blocked' ? 'task.blockedNote' : status && result.pending ? 'task.runningNote' : 'task.unknown')}</p>
              {waiting && !result.approvalId && onBack && <div><Button variant="outline" onClick={onBack}>
                {t('task.approvalInbox')}<ArrowUpRight size={17} aria-hidden="true" />
              </Button></div>}
            </Card>
          )}
          {result.artifacts && result.artifacts.length > 0 && (
            <Card className="task-files gap-3" role="region" aria-label={t('files.title')}>
              <h2 className="m-0 text-[15px]">{t('files.title')}</h2>
              <ArtifactList artifacts={result.artifacts} label={t('files.title')} />
            </Card>
          )}
          {result.approvalId && <RuntimeApprovalCard approvalId={result.approvalId} onDecided={() => {
            activity.reload(); setAttempt((n) => n + 1);
          }} />}
          {(needsReview || needsInput) && <Card className="gap-3">
            <p>{t(needsReview ? 'task.reviewHelp' : 'task.inputHelp')}</p>
            <div className="flex flex-wrap gap-2">
              {needsReview && repo.confirmTaskReview && <Button disabled={reviewBusy} onClick={() => void settle('confirm')}>{t('task.confirmReview')}</Button>}
              {onOpenAsk && !result.summaryOnly && <Button variant={needsReview ? 'outline' : 'primary'} onClick={continueTask}>{t(needsReview ? 'task.requestChanges' : 'task.provideInput')}</Button>}
              {needsInput && repo.confirmTaskReview && <Button variant="outline" disabled={reviewBusy} onClick={() => void settle('confirm')}>{t('task.markDone')}</Button>}
              {repo.dismissTask && <Button variant="outline" disabled={reviewBusy} onClick={() => void settle('dismiss')}>{t('task.dismiss')}</Button>}
            </div>
            {reviewError && <p role="alert">{reviewError}</p>}
          </Card>}
          {detail.advanced && !result.summaryOnly && <details className="task-trace" onToggle={(event) => setTraceOpen(event.currentTarget.open)}>
            <summary>{t('activity.trace')}</summary>
            {traceOpen && <RunTrace runId={runId} />}
          </details>}
        </>
      )}
    </section>
  );
}
