import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Button, Tag, type Tone } from "@/components/ui";

export type WorkSignalState =
  | "ready"
  | "sending"
  | "queued"
  | "waking"
  | "working"
  | "retrying"
  | "done"
  | "waiting"
  | "failed";

const ACTIVE = new Set<WorkSignalState>([
  "sending",
  "queued",
  "waking",
  "working",
  "retrying",
]);

/**
 * Jentera's state mark. It only animates while real work is active; the
 * global reduced-motion rule turns that movement into a static state.
 */
export function WorkPulse({
  state,
  compact = false,
}: {
  state: WorkSignalState;
  compact?: boolean;
}) {
  return (
    <span
      className={`work-pulse work-pulse-${state} ${ACTIVE.has(state) ? "work-pulse-active" : ""} ${
        compact ? "work-pulse-compact" : ""
      }`}
      aria-hidden="true"
    >
      <span>J</span>
    </span>
  );
}

/**
 * In-thread "Jentera is working…" indicator: three animated dots plus the
 * live state text (queued / waking / working / retrying). A pending answer
 * reads like a normal chat turn instead of a full-width status card.
 */
export function TypingBubble({ label }: { label: string }) {
  return (
    <div className="bubble bubble-in flex min-w-0 items-center gap-2.5">
      <span className="typing" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span
        role="status"
        className="min-w-0 text-[13px] font-medium leading-snug text-text-secondary"
      >
        {label}
      </span>
    </div>
  );
}

export function OutcomeReceipt({
  title,
  outcome,
  audience,
  evidence,
  meta,
  statusLabel,
  statusTone = "green",
  state = "done",
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
            <h3 className="text-sm font-medium leading-snug text-text">
              {title}
            </h3>
            <Tag tone={statusTone}>{statusLabel}</Tag>
          </div>
          {outcome ? (
            <p className="text-[13px] leading-relaxed text-text-secondary">
              {outcome}
            </p>
          ) : null}
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
          <Button
            variant="ghost"
            className="min-h-0 px-3 py-2 text-[11px]"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
