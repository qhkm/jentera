import { useEffect, useState, type ReactNode } from "react";
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
      <svg
        width={compact ? 19 : 24}
        height={compact ? 19 : 24}
        viewBox="0 0 64 64"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M28 14h20v19c0 12-7 19-19 19S10 45 10 34h12c0 5 2 7 7 7s7-3 7-8v-7h-8V14Z" />
        <rect x="12" y="14" width="10" height="10" rx="2" opacity=".65" />
      </svg>
    </span>
  );
}

/**
 * In-thread "Jentera is working…" indicator: three animated dots plus the
 * live state text (queued / waking / working / retrying). A pending answer
 * reads like a normal chat turn instead of a full-width status card.
 */
/** Whole seconds since `since`, ticking once a second; null without one. */
function useElapsedSeconds(since?: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (since === undefined) return null;
  return Math.max(0, Math.floor((now - since) / 1_000));
}

/** The seconds since `since`, for a row that is still in progress. */
export function ElapsedSince({ since }: { since?: number }) {
  const seconds = useElapsedSeconds(since);
  if (seconds === null || seconds < 1) return null;
  return <span className="text-text-tertiary tabular-nums"> · {seconds}s</span>;
}

/** The waiting bubble. With `since` it counts the seconds up next to the
    status, so a slow reply and a dead one look different: the agent's own
    status lines can be seconds apart, and nothing else moved in between. */
export function TypingBubble({ label, since }: { label: string; since?: number }) {
  const seconds = useElapsedSeconds(since);
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
        {seconds !== null && seconds >= 1 ? (
          <span className="text-text-tertiary tabular-nums"> · {seconds}s</span>
        ) : null}
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
