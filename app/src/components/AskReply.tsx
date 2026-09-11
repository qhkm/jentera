import { useEffect, useState } from 'react';
import { RuntimeApprovalCard } from './RuntimeApprovalCard';
import { renderReplyMarkdown } from '@/lib/reply-markdown';
import { ArrowUpRight, Check, Copy, Info, WarningCircle } from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';
import { ElapsedSince, TypingBubble } from '@/components/WorkSignal';
import { useToast } from '@/components/Toast';
import { useT } from '@/i18n/I18nProvider';
import type { AskMessage } from '@/hooks/useAsk';
import { ChatTaskCard } from '@/components/ChatTaskCard';
import { isRunId } from '@/lib/task';

/** The agent's steps and tool calls as a list: done ones ticked, the
    current one moving with the seconds since the message was sent. */
function StepsList({ steps, live, since }: { steps: string[]; live: boolean; since?: number }) {
  return (
    <ol className="ask-steps" aria-label="Steps">
      {steps.map((step, index) => {
        const current = live && index === steps.length - 1;
        return (
          <li key={`${index}-${step}`} aria-current={current ? 'step' : undefined}>
            {current
              ? <span className="ask-step-dot" aria-hidden="true" />
              : <Check size={13} aria-hidden="true" className="ask-step-done" />}
            <span className="ask-step-label">{step}</span>
            {current && <ElapsedSince since={since} />}
          </li>
        );
      })}
    </ol>
  );
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
        {message.state === 'done' && message.kind === 'work' && message.taskStatus === 'completed' && (
          <span className="ask-reply-ready">
            <Check size={12} aria-hidden="true" />
            {t('ask.reply.ready')}
          </span>
        )}
      </header>
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
          : linkedTask
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
          {failed && linkedTask ? (
            <p className="task-recovery-note">{t('task.checkBeforeRetry')}</p>
          ) : failed ? (
            <button type="button" className="ask-inline-action" onClick={onRetry}>
              <WarningCircle size={16} aria-hidden="true" />
              {t('ask.retry')}
            </button>
          ) : (
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
                  <StepsList steps={message.steps} live={false} />
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
          )}
        </>
      )}
      {linkedTask && (
        <ChatTaskCard message={message} onOpen={() => onOpenActivity?.(message.runId, message.taskTitle)} />
      )}
    </article>
  );
}
