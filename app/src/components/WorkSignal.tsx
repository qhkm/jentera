import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Button, Tag, type Tone } from '@/components/ui';

export type WorkSignalState =
  | 'ready'
  | 'sending'
  | 'queued'
  | 'waking'
  | 'working'
  | 'retrying'
  | 'done'
  | 'waiting'
  | 'failed';

const ACTIVE = new Set<WorkSignalState>(['sending', 'queued', 'waking', 'working', 'retrying']);

/**
 * Jentera's state mark. It only animates while real work is active; the
 * global reduced-motion rule turns that movement into a static state.
 */
export function WorkPulse({ state, compact = false }: { state: WorkSignalState; compact?: boolean }) {
  return (
    <span
      className={`work-pulse work-pulse-${state} ${ACTIVE.has(state) ? 'work-pulse-active' : ''} ${
        compact ? 'work-pulse-compact' : ''
      }`}
      aria-hidden="true"
    >
      <span>J</span>
    </span>
  );
}

export function WorkStatusBar({
  state,
  title,
  audience,
}: {
  state: WorkSignalState;
  title: string;
  audience: string;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-5"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <WorkPulse state={state} compact />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{title}</span>
      <Tag tone="green" className="hidden shrink-0 sm:inline-flex">{audience}</Tag>
      <span className="size-1.5 shrink-0 rounded-full bg-brand sm:hidden" aria-hidden="true" />
    </div>
  );
}

export function LiveWorkCard({
  state,
  title,
  detail,
  audience,
  steps,
}: {
  state: WorkSignalState;
  title: string;
  detail: string;
  audience: string;
  steps: { label: string; state: 'done' | 'active' | 'next' }[];
}) {
  return (
    <article
      className="live-work-card"
      aria-label={title}
    >
      <div className="flex items-start gap-3">
        <WorkPulse state={state} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-pixel text-[15px] tracking-tight text-text">{title}</h3>
            <Tag tone="green">{audience}</Tag>
          </div>
          <p className="text-[12px] leading-relaxed text-text-secondary">{detail}</p>
        </div>
      </div>
      <ol className="live-work-steps" aria-label={title}>
        {steps.map((step) => (
          <li key={step.label} className={`live-work-step live-work-step-${step.state}`}>
            <span aria-hidden="true">{step.state === 'done' ? '✓' : ''}</span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

export function OutcomeReceipt({
  title,
  outcome,
  audience,
  evidence,
  meta,
  statusLabel,
  statusTone = 'green',
  state = 'done',
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  outcome?: string | null;
  audience: string;
  evidence?: string | null;
  meta?: string;
  statusLabel: string;
  statusTone?: Tone;
  state?: WorkSignalState;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <article className={`outcome-receipt outcome-receipt-${state}`}>
      <div className="flex items-start gap-3">
        <WorkPulse state={state} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-sm font-medium leading-snug text-text">{title}</h3>
            <Tag tone={statusTone}>{statusLabel}</Tag>
          </div>
          {outcome ? <p className="text-[13px] leading-relaxed text-text-secondary">{outcome}</p> : null}
        </div>
      </div>
      <div className="outcome-receipt-proof">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="shield" size={14} className="text-brand" />
          {audience}
        </span>
        {evidence ? <span>{evidence}</span> : null}
        {meta ? <span>{meta}</span> : null}
      </div>
      {children}
      {actionLabel && onAction ? (
        <div>
          <Button variant="ghost" className="min-h-0 px-3 py-2 text-[11px]" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
