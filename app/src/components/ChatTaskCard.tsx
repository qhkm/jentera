import { ArrowUpRight, CheckCircle, ClipboardText, Clock, Info } from '@phosphor-icons/react';
import type { AskMessage } from '@/hooks/useAsk';
import { useT } from '@/i18n/I18nProvider';

export function ChatTaskCard({ message, onOpen }: { message: AskMessage; onOpen: () => void }) {
  const t = useT();
  const pending = Boolean(message.pendingId);
  const done = message.taskStatus === 'completed';
  const label = message.taskStatus === 'needs_input' ? 'task.needsInput'
    : message.taskStatus === 'needs_review' ? 'task.needsReview'
    : message.taskStatus === 'blocked' ? 'work.blocked'
    : message.taskStatus === 'needs_approval' ? 'work.waiting'
    : done ? 'work.done' : 'task.checkStatus';
  const StatusIcon = pending ? Clock : done ? CheckCircle : Info;
  return (
    <button type="button" className="chat-task-card" onClick={onOpen}>
      <span className="chat-task-icon"><ClipboardText size={22} aria-hidden="true" /></span>
      <span className="chat-task-content">
        <span className="chat-task-label">{t('task.card.label')}</span>
        <strong>{typeof message.taskTitle === 'string' ? message.taskTitle : t('task.title')}</strong>
        <span className="chat-task-status">
          <StatusIcon size={15} aria-hidden="true" />
          {pending ? message.text : t(label)}
        </span>
      </span>
      <span className="chat-task-open">{t('task.open')}<ArrowUpRight size={17} aria-hidden="true" /></span>
    </button>
  );
}
