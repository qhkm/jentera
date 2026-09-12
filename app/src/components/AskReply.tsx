import { useEffect, useState } from 'react';
import { RuntimeApprovalCard } from './RuntimeApprovalCard';
import { renderReplyMarkdown } from '@/lib/reply-markdown';
import { ArrowUpRight, Check, Copy, Info, WarningCircle } from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';
import { TypingBubble } from '@/components/WorkSignal';
import { ArtifactList } from '@/components/ArtifactList';
import { useToast } from '@/components/Toast';
import { useT } from '@/i18n/I18nProvider';
import type { AskMessage } from '@/hooks/useAsk';
import { ChatTaskCard } from '@/components/ChatTaskCard';
import { isRunId } from '@/lib/task';
import { TaskCoordination } from './TaskCoordination';
import { useRepository, type Artifact } from '@/lib/repo';
import { TaskProgress } from '@/components/TaskProgress';

/** A bounded activity summary; tool starts do not prove successful completion. */
function StepsList({ steps, live, since }: { steps: string[]; live: boolean; since?: number }) {
  return <TaskProgress steps={steps} live={live} since={since} />;
}

export function AskReply({
  message,
  onRetry,
  onOpenActivity,
}: {
  message: AskMessage;
  onRetry: () => void;
  onOpenActivity?: (runId?: string, title?: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const repo = useRepository();
  const [recovered, setRecovered] = useState<Artifact[]>([]);
  useEffect(() => {
    let live = true;
    setRecovered([]);
    if (message.state === 'failed' && message.runId && isRunId(message.runId)) {
      void repo.listArtifacts?.({ runId: message.runId }).then(files => { if (live) setRecovered(files); }).catch(() => {});
    }
    return () => { live = false; };
  }, [message.runId, message.state, repo]);
  const files = message.artifacts?.length ? message.artifacts : recovered;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      toast(t('ask.reply.copied'));
    } catch {
      toast(t('ask.reply.copyFailed'), 'error');
    }
  }

  const failed = Boolean(message.failedQuestion);
  /* Execution mode and reasoning depth do not decide whether a reply is a
     business task. Keep interrupted accepted runs reachable to prevent resends. */
  const accepted = Boolean(message.failedQuestion) && isRunId(message.runId);
  const isWork = message.kind === 'work' || accepted;
  const linkedTask = isWork && message.mode === 'work' && isRunId(message.runId) && Boolean(onOpenActivity);
  return (
    <article
      className={`ask-reply ${failed ? 'ask-reply-failed' : ''}`}
      aria-label={message.agent ?? 'Jentera'}
    >
      <header>
        <JenteraMark size={25} />
        <strong>{message.agent ?? 'Jentera'}</strong>
        {isRunId(message.runId) && <TaskCoordination key={message.runId} runId={message.runId!} live={Boolean(message.pendingId)} />}
        {message.state === 'done' && message.kind === 'work' && message.taskStatus === 'completed' && (
          <span className="ask-reply-ready">
            <Check size={12} aria-hidden="true" />
            {t('ask.reply.ready')}
          </span>
        )}
      </header>
      {message.pendingId && message.connectionStatus && <p role="status" className="text-sm text-text-secondary">{message.connectionStatus}</p>}
      {message.pendingId ? (
        /* Waiting on a person, not a machine — so no spinner. Any answer text
           already streamed stays above the card: the agent often says what it
           intends before asking, and that is the reason the owner needs. */
        message.state === 'needs_approval' && message.approvalId
          ? (
            <>
              {message.text && message.state !== 'needs_approval'
                ? <div className="ask-reply-text">{renderReplyMarkdown(message.text)}</div>
                : null}
              <RuntimeApprovalCard approvalId={message.approvalId} />
            </>
          )
          : message.state === 'streaming'
          ? (
            <>
              <div className="ask-reply-text" aria-live="polite">
                {renderReplyMarkdown(message.text)}
              </div>
              {message.steps?.length
                ? <StepsList steps={message.steps} live={Boolean(message.liveStatus)} since={message.startedAt} />
                : message.liveStatus && (
                  <div className="mt-2">
                    <TypingBubble label={message.liveStatus} since={message.startedAt} />
                  </div>
                )}
            </>
          )
          : linkedTask && !message.steps?.length
            ? <p className="sr-only" role="status">{message.text}</p>
            : message.steps?.length
              ? (
                <>
                  <p className="sr-only" role="status">{message.text}</p>
                  <StepsList steps={message.steps} live since={message.startedAt} />
                </>
              )
              : <TypingBubble label={message.text} since={message.startedAt} />
      ) : (
        <>
          <div className="ask-reply-text" role={failed ? 'alert' : undefined}>
            {renderReplyMarkdown(message.text)}
          </div>
          {files.length > 0 && <ArtifactList artifacts={files} inlineImages label={t('ask.files')} className="mt-3" />}
          {failed && message.steps && message.steps.length > 0 && (
            <details className="ask-reply-source ask-reply-steps">
              <summary>{t('ask.steps.title')} · {t('ask.steps.count', { n: message.steps.length })}</summary>
              <TaskProgress steps={message.steps} live={false} receipt />
            </details>
          )}
          {failed && linkedTask ? (
            <p className="task-recovery-note">{t('task.checkBeforeRetry')}</p>
          ) : failed ? (
            <button type="button" className="ask-inline-action" onClick={onRetry}>
              <WarningCircle size={16} aria-hidden="true" />
              {t('ask.retry')}
            </button>
          ) : (
            <>
              <footer>
              <button type="button" className="ask-inline-action" onClick={() => void copy()}>
                {copied ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <Copy size={15} aria-hidden="true" />
                )}
                {t(copied ? 'ask.reply.copied' : 'ask.reply.copy')}
              </button>
              {message.steps && message.steps.length > 0 && (
                <details className="ask-reply-source ask-reply-steps">
                  <summary>
                    <Info size={15} aria-hidden="true" />
                    {t('ask.steps.title')} · {t('ask.steps.count', { n: message.steps.length })}
                  </summary>
                  <TaskProgress steps={message.steps} live={false} receipt />
                </details>
              )}
              {message.grounded !== undefined && (
                <details className="ask-reply-source">
                  <summary>
                    <Info size={15} aria-hidden="true" />
                    {t('ask.reply.source')}
                  </summary>
                  <p>
                    {message.grounded
                      ? message.usedKeys?.length
                        ? t('ask.receipt.facts', { n: message.usedKeys.length })
                        : t('ask.receipt.grounded')
                      : t('ask.receipt.noFacts')}
                  </p>
                </details>
              )}
              {message.state === 'done' && (isWork || message.kind === undefined) && onOpenActivity && !linkedTask && (
                <button
                  type="button"
                  className="ask-inline-action ask-reply-activity"
                  onClick={() => onOpenActivity()}
                >
                  {t('ask.receipt.activity')}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              )}
            </footer>
            </>
          )}
        </>
      )}
      {linkedTask && (
        <ChatTaskCard message={message} onOpen={() => onOpenActivity?.(message.runId, message.taskTitle)} />
      )}
    </article>
  );
}
