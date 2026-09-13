import { useEffect, useState } from 'react';
import { RuntimeApprovalCard } from './RuntimeApprovalCard';
import { ReminderCard } from './ReminderCard';
import { reminderProposal } from '@/lib/reminders';
import { renderReplyMarkdown } from '@/lib/reply-markdown';
import { ArrowUpRight, Check, Copy, Info, WarningCircle } from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';
import { ElapsedSince } from '@/components/WorkSignal';
import { ArtifactList } from '@/components/ArtifactList';
import { LiveTaskProgress } from '@/components/LiveTaskProgress';
import { useToast } from '@/components/Toast';
import { useT, useI18n } from '@/i18n/I18nProvider';
import { displayWorkspacePaths, presentTaskSteps } from '@/lib/task-presentation';
import { useDetailLevel } from '@/hooks/useDetailLevel';
import type { AskMessage } from '@/hooks/useAsk';
import { ChatTaskCard } from '@/components/ChatTaskCard';
import { isRunId } from '@/lib/task';
import { TaskCoordination } from './TaskCoordination';
import { useRepository, type Artifact } from '@/lib/repo';

/** The agent's steps and tool calls as a list: done ones ticked, the
    current one moving with the seconds since the message was sent. */
function StepsList({ steps, live, since }: { steps: string[]; live: boolean; since?: number }) {
  const { lang } = useI18n();
  const { advanced } = useDetailLevel();
  const entries = presentTaskSteps(steps, lang, { advanced });
  return (
    <ol className="ask-steps" aria-label="Steps">
      {entries.map((entry, index) => {
        const current = live && index === entries.length - 1;
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
  const repo = useRepository();
  const proposal = !message.pendingId && message.state !== 'failed' ? reminderProposal(message.text, message.runId) : { text: message.text };
  const reminderDraft = proposal.draft ?? message.reminderDraft;
  const displayText = message.pendingId ? message.text.replace(/```jentera-reminder[\s\S]*?(?:```|$)/g, '') : proposal.text;
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
      await navigator.clipboard.writeText(displayWorkspacePaths(proposal.text));
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
      {reminderDraft && <ReminderCard key={reminderDraft.id} draft={reminderDraft} />}
      {message.pendingId && message.connectionStatus && <p role="status" className="text-sm text-text-secondary">{message.connectionStatus}</p>}
      {message.pendingId ? (
        /* Waiting on a person, not a machine — so no spinner. Any answer text
           already streamed stays above the card: the agent often says what it
           intends before asking, and that is the reason the owner needs. */
        message.state === 'needs_approval' && message.approvalId
          ? (
            <>
              {message.text && message.state !== 'needs_approval'
                ? <div className="ask-reply-text">{renderReplyMarkdown(displayWorkspacePaths(displayText))}</div>
                : null}
              <RuntimeApprovalCard approvalId={message.approvalId} />
            </>
          )
          : message.state === 'streaming'
          ? (
            <>
              <div className="ask-reply-text" aria-live="polite">
                {renderReplyMarkdown(displayWorkspacePaths(displayText))}
              </div>
              {message.steps?.length
                ? <LiveTaskProgress steps={message.steps} since={message.startedAt} lastProgressAt={message.lastProgressAt} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
                : (
                  <div className="mt-2">
                    <LiveTaskProgress steps={[]} label={message.liveStatus} since={message.startedAt} lastProgressAt={message.lastProgressAt} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
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
                  <LiveTaskProgress steps={message.steps} since={message.startedAt} lastProgressAt={message.lastProgressAt} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
                </>
              )
              : <LiveTaskProgress steps={[]} label={message.text} since={message.startedAt} lastProgressAt={message.lastProgressAt} disconnected={Boolean(message.connectionStatus)} durable={isRunId(message.runId)} />
      ) : (
        <>
          <div className="ask-reply-text" role={failed ? 'alert' : undefined}>
            {renderReplyMarkdown(displayWorkspacePaths(displayText))}
          </div>
          {files.length > 0 && <ArtifactList artifacts={files} inlineImages label={t('ask.files')} className="mt-3" />}
          {missingImages.length > 0 && <p className="task-recovery-note" role="status">Some images weren’t attached: {missingImages.join(', ')}. Ask Jentera to attach them again.</p>}
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
