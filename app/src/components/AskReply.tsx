import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, Info, WarningCircle } from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';
import { TypingBubble } from '@/components/WorkSignal';
import { useToast } from '@/components/Toast';
import { useT } from '@/i18n/I18nProvider';
import type { AskMessage } from '@/hooks/useAsk';
import { ChatTaskCard } from '@/components/ChatTaskCard';
import { isRunId } from '@/lib/task';

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
  /* A card means Jentera did work: deep mode by request, or a finished run
     the server classified as work (a tool, an approval). A quick reply the
     server called conversation reads as a plain reply. Two cases keep the
     card regardless: an answer with no verdict (replies saved before the
     verdict existed) stays a task as it always was, and an accepted run
     whose reply was interrupted must be checked, never resent. */
  const accepted = Boolean(message.failedQuestion) && isRunId(message.runId);
  const isWork = message.depth === 'deep' || message.kind === 'work' ||
    (message.kind === undefined && message.state === 'done') || accepted;
  const linkedTask = isWork && message.mode === 'work' && isRunId(message.runId) && Boolean(onOpenActivity);
  return (
    <article
      className={`ask-reply ${failed ? 'ask-reply-failed' : ''}`}
      aria-label={message.agent ?? 'Jentera'}
    >
      <header>
        <JenteraMark size={25} />
        <strong>{message.agent ?? 'Jentera'}</strong>
        {message.state === 'done' && (
          <span className="ask-reply-ready">
            <Check size={12} aria-hidden="true" />
            {t('ask.reply.ready')}
          </span>
        )}
      </header>
      {message.pendingId ? (
        message.state === 'streaming'
          ? <div className="ask-reply-text" aria-live="polite">{message.text}</div>
          : linkedTask
            ? <p className="sr-only" role="status">{message.text}</p>
            : <TypingBubble label={message.text} since={message.startedAt} />
      ) : (
        <>
          <div className="ask-reply-text" role={failed ? 'alert' : undefined}>
            {message.text}
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
              {message.state === 'done' && isWork && onOpenActivity && !linkedTask && (
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
