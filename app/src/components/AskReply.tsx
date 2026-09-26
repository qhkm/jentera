import { useEffect, useState } from 'react';
import { RuntimeApprovalCard } from './RuntimeApprovalCard';
import { VaultApprovalCard } from './VaultApprovalCard';
import { ReminderCard } from './ReminderCard';
import { reminderProposal } from '@/lib/reminders';
import { browserHandoff, hideStreamingBrowserHandoff } from '@/lib/browser-handoff';
import { BrowserHandoffCard } from './BrowserHandoffCard';
import { connectionHandoff, hideStreamingConnectionHandoff } from '@/lib/connection-handoff';
import { CalendarConnectCard } from '@/components/CalendarConnectCard';
import { StopWork } from './StopWork';
import { TaskRecoveryActions } from '@/components/TaskRecoveryActions';
import { renderReplyMarkdown } from '@/lib/reply-markdown';
import { ArrowUpRight, Check, Clock, Copy, Info, WarningCircle } from '@phosphor-icons/react';
import { JenteraMascot } from '@/components/JenteraMascot';
import { ElapsedSince } from '@/components/WorkSignal';
import { ArtifactList } from '@/components/ArtifactList';
import { LiveTaskProgress } from '@/components/LiveTaskProgress';
import { ComputerPreview } from '@/components/ComputerPreview';
import { useToast } from '@/components/Toast';
import { useT, useI18n } from '@/i18n/I18nProvider';
import { INLINE_STEPS, displayWorkspacePaths, presentTaskSteps, stepTail } from '@/lib/task-presentation';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import type { AskMessage } from '@/hooks/useAsk';
import { isRunId } from '@/lib/task';
import { TaskCoordination } from './TaskCoordination';
import { useRepository, type Artifact } from '@/lib/repo';

/** The agent's steps and tool calls as a list: done ones ticked, the
    current one moving with the seconds since the message was sent. */
function StepsList({ steps, live, since }: { steps: string[]; live: boolean; since?: number }) {
  const { lang } = useI18n();
  const t = useT();
  const { advanced } = useDetailLevel();
  const [expanded, setExpanded] = useState(false);
  const entries = presentTaskSteps(steps, lang, { advanced });
  const { shown, hidden } = stepTail(entries, INLINE_STEPS, expanded);
  return (
    <>
      <ol className="ask-steps" aria-label="Steps">
        {shown.map((entry, index) => {
          const current = live && index === shown.length - 1;
          return (
            <li key={`${index}-${entry.label}`} aria-current={current ? 'step' : undefined}>
              {current
                ? <span className="ask-step-dot" aria-hidden="true" />
                : <Check size={13} aria-hidden="true" className="ask-step-done" />}
              <div className="ask-step-content">
                <span className="ask-step-label">{entry.label}</span>
                {entry.subject && <span className="ask-step-subject">{entry.subject}</span>}
                {(entry.count > 1 || current) && <div className="ask-step-meta">
                  {entry.count > 1 && <span className="ask-step-count">{lang === 'bm' ? `${entry.count} langkah` : `${entry.count} steps`}</span>}
                  {current && <ElapsedSince since={since} separator={entry.count > 1} />}
                </div>}
              </div>
            </li>
          );
        })}
      </ol>
      {(hidden > 0 || expanded) && (
        <button type="button" className="ask-step-more" aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>
          {expanded ? t('ask.steps.fewer') : t('ask.steps.earlier', { n: hidden })}
        </button>
      )}
    </>
  );
}

export function AskReply({
  message,
  onRetry,
  onRetryWithMoreTime,
  onOpenActivity,
  onOpenBusinessBrowser,
  onContinueTask,
}: {
  message: AskMessage;
  onRetry: () => void;
  /** Sends the failed question again in deep mode. */
  onRetryWithMoreTime?: () => void;
  onOpenActivity?: (runId?: string, title?: string) => void;
  onOpenBusinessBrowser?: () => void;
  onContinueTask?: (context: string, sessionId?: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const repo = useRepository();
  const proposal = !message.pendingId && message.state !== 'failed' ? reminderProposal(message.text, message.runId) : { text: message.text };
  const reminderDraft = proposal.draft ?? message.reminderDraft;
  const completedRequest = message.from === 'ai' && message.state === 'done' && !message.pendingId && !message.failedQuestion;
  const connection = completedRequest ? connectionHandoff(proposal.text, message.runId) : { text: proposal.text };
  const handoff = completedRequest
    ? browserHandoff(connection.text, message.runId)
    : { text: proposal.text };
  // Also clean saved replies produced before the server-side marker fix.
  const displayText = (message.pendingId ? hideStreamingConnectionHandoff(hideStreamingBrowserHandoff(message.text.replace(/```jentera-reminder[\s\S]*?(?:```|$)/g, ''))) : handoff.text)
    .replace(/(?:^|\n)\s*(?:[-*•>]\s*)?(?:\*\*|\*)?\s*@step:[*_]{0,2}[^\n]*/gi, '');
  const [recovered, setRecovered] = useState<Artifact[]>([]);
  const [filesChecked, setFilesChecked] = useState(false);
  const imageNames = [...new Set(Array.from(displayText.matchAll(/\boutputs\/([A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:png|jpe?g|webp|gif))\b/gi), match => match[1]))];
  const imageKey = JSON.stringify(imageNames);
  useEffect(() => {
    let live = true;
    setRecovered([]);
    setFilesChecked(false);
    if (!message.pendingId && (message.state === 'failed' || (message.state === 'done' && imageKey !== '[]')) && message.runId && isRunId(message.runId) && repo.listArtifacts) {
      const names: string[] = JSON.parse(imageKey);
      void Promise.all([
        repo.listArtifacts({ runId: message.runId }),
        names.length ? repo.listArtifacts({ relatedRunId: message.runId, limit: 200 }) : Promise.resolve([]),
      ]).then(([current, earlier]) => {
        const files = [...current];
        for (const file of earlier) {
          if (names.includes(file.name) && !files.some(existing => existing.name === file.name)) files.push(file);
        }
        if (live) { setRecovered(files); setFilesChecked(true); }
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [message.runId, message.state, message.pendingId, imageKey, repo]);
  const files = [...(message.artifacts ?? []), ...recovered.filter(file => !message.artifacts?.some(existing => existing.id === file.id || existing.name === file.name))];
  const missingImages = filesChecked ? imageNames.filter(name => !files.some(file => file.name === name)) : [];

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(displayWorkspacePaths(displayText));
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
  /* Two things the task card carried had to survive its removal, and the
     rest was furniture that made every exchange read as a tracked job. A
     durable run may already have done part of its work, so a blind retry
     could repeat it; and the reply has to stay a way into the run it
     produced, which is why the links below carry the id rather than
     landing on the whole of Activity. */
  const durableWork = isWork && isRunId(message.runId);
  return (
    <article
      className={`ask-reply ${failed ? 'ask-reply-failed' : ''}`}
      aria-label={message.agent ?? 'Jentera'}
    >
      <header>
        <JenteraMascot size={30} />
        <strong>{message.agent ?? 'Jentera'}</strong>
        {isRunId(message.runId) && <TaskCoordination key={message.runId} runId={message.runId!} live={Boolean(message.pendingId)} />}
        {message.state === 'done' && message.kind === 'work' && message.taskStatus === 'completed' && (
          <span className="ask-reply-ready">
            <Check size={12} aria-hidden="true" />
            {t('ask.reply.ready')}
          </span>
        )}
      </header>
      {reminderDraft && <ReminderCard key={reminderDraft.id} draft={reminderDraft} />}
      {message.pendingId ? (<>
        {/* Waiting on a person, not a machine — so no spinner. Any answer text
           already streamed stays above the card: the agent often says what it
           intends before asking, and that is the reason the owner needs. */}
        {message.state === 'needs_approval' && message.approvalId
          ? (
            <>
              {message.text && message.state !== 'needs_approval'
                ? <div className="ask-reply-text">{renderReplyMarkdown(displayWorkspacePaths(displayText))}</div>
                : null}
              {message.approvalSource === 'vault'
                ? <VaultApprovalCard approvalId={message.approvalId} />
                : <RuntimeApprovalCard approvalId={message.approvalId} />}
            </>
          )
          : message.state === 'streaming'
          ? (
            <>
              <div className="ask-reply-text" aria-live="polite">
                {renderReplyMarkdown(displayWorkspacePaths(displayText))}
              </div>
              {message.steps?.length
                ? <LiveTaskProgress action={<StopWork runId={message.runId} />} taskLabel={message.taskProgressLabel} steps={message.steps} since={message.startedAt} lastProgressAt={message.lastProgressAt} connectionLabel={message.connectionStatus} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
                : (
                  <div className="mt-2">
                    <LiveTaskProgress action={<StopWork runId={message.runId} />} steps={[]} label={message.liveStatus} since={message.startedAt} lastProgressAt={message.lastProgressAt} connectionLabel={message.connectionStatus} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
                  </div>
                )}
            </>
          )
          : message.steps?.length
              ? (
                <>
                  <LiveTaskProgress action={message.state !== 'needs_approval' ? <StopWork runId={message.runId} /> : undefined} taskLabel={message.taskProgressLabel} steps={message.steps} since={message.startedAt} lastProgressAt={message.lastProgressAt} connectionLabel={message.connectionStatus} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
                </>
              )
              : <LiveTaskProgress action={message.state !== 'needs_approval' ? <StopWork runId={message.runId} /> : undefined} steps={[]} label={message.text} since={message.startedAt} lastProgressAt={message.lastProgressAt} connectionLabel={message.connectionStatus} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
        }
      </>) : (
        <>
          {message.steps && message.steps.length > 0 && (
            <section className="ask-step-card" aria-label={t('ask.steps.title')}>
              <p className="ask-step-card-title">
                {t('ask.steps.title')} · {t('ask.steps.count', { n: message.steps.length })}
              </p>
              <StepsList steps={message.steps} live={false} />
            </section>
          )}
          <div className="ask-reply-text" role={failed ? 'alert' : undefined}>
            {renderReplyMarkdown(displayWorkspacePaths(displayText))}
          </div>
          {connection.connector && <CalendarConnectCard runId={message.runId} title={message.taskTitle} onContinue={onContinueTask} />}
          {!connection.connector && handoff.reason && onOpenBusinessBrowser && <BrowserHandoffCard reason={handoff.reason} onOpen={onOpenBusinessBrowser} runId={message.runId} title={message.taskTitle} onContinue={onContinueTask} />}
          {/* A reminder card is the input the reply waits for. A second
              "Continue in Chat" beside it sent an empty follow-up on 25 Sep. */}
          {completedRequest && !connection.connector && !handoff.reason && !reminderDraft && isRunId(message.runId)
            && ['needs_input', 'blocked'].includes(message.taskStatus ?? '') && onContinueTask && (
              <section className="card ask-browser-handoff" aria-label={t('task.recovery.title')}>
                <h3>{t('task.recovery.title')}</h3>
                <TaskRecoveryActions runId={message.runId!} request="input" title={message.taskTitle} onContinue={onContinueTask} />
              </section>
            )}
          {files.length > 0 && <ArtifactList artifacts={files} inlineImages label={t('ask.files')} className="mt-3" />}
          {missingImages.length > 0 && <p className="task-recovery-note" role="status">Some images weren’t attached: {missingImages.join(', ')}. Ask Jentera to attach them again.</p>}
          {failed && message.retryWithMoreTime && onRetryWithMoreTime ? (
            /* The run ended at the quick cap, so it is not "still running",
               and the same request would stop at the same place. */
            <>
              <p className="task-recovery-note">{t('ask.moreTime.note')}</p>
              <button type="button" className="ask-inline-action" onClick={onRetryWithMoreTime}>
                <Clock size={16} aria-hidden="true" />
                {t('ask.moreTime')}
              </button>
            </>
          ) : failed && durableWork ? (
            <>
              <p className="task-recovery-note">{t('task.checkBeforeRetry')}</p>
              {onOpenActivity && (
                <button
                  type="button"
                  className="ask-inline-action"
                  onClick={() => onOpenActivity(message.runId, message.taskTitle)}
                >
                  {t('task.checkStatus')}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              )}
            </>
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
              {message.state === 'done' && (isWork || message.kind === undefined) && onOpenActivity && (
                <button
                  type="button"
                  className="ask-inline-action ask-reply-activity"
                  onClick={() => onOpenActivity(durableWork ? message.runId : undefined, durableWork ? message.taskTitle : undefined)}
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
      {message.pendingId && message.state !== 'needs_approval' && isRunId(message.runId) && (
        <ComputerPreview key={message.runId} runId={message.runId!} onTakeControl={onOpenBusinessBrowser}
          takeControlLabel={t('browser.takeControl')} />
      )}
    </article>
  );
}
