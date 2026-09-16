import { CheckCircle, Clock, ShieldCheck, XCircle } from '@phosphor-icons/react';

export type HumanApprovalStatus = 'pending' | 'deciding' | 'approved' | 'denied' | 'expired';

export interface ApprovalFact {
  label: string;
  value: string;
}

export function HumanApprovalCard({
  title,
  eyebrow,
  summary,
  facts,
  disclosure,
  status,
  statusLabel,
  unavailable,
  retryLabel,
  approveLabel,
  denyLabel,
  approvedLabel,
  deniedLabel,
  closedLabel,
  problem,
  remoteDecision,
  onRetry,
  onDecision,
}: {
  title: string;
  eyebrow?: string;
  summary: string;
  facts: ApprovalFact[];
  disclosure: string;
  status: HumanApprovalStatus;
  statusLabel: string;
  unavailable?: string;
  retryLabel: string;
  approveLabel: string;
  denyLabel: string;
  approvedLabel: string;
  deniedLabel: string;
  closedLabel: string;
  problem?: string | null;
  remoteDecision?: boolean;
  onRetry?: () => void;
  onDecision: (decision: 'approve' | 'deny') => void;
}) {
  if (unavailable) {
    return (
      <div className="ask-approval-unavailable">
        <p>{unavailable}</p>
        {onRetry && <button type="button" className="btn btn-outline" onClick={onRetry}>{retryLabel}</button>}
      </div>
    );
  }

  const settled = status === 'approved' || status === 'denied' || status === 'expired';
  return (
    <section className="ask-approval" aria-label={title}>
      <header className="ask-approval-header">
        <span className="ask-approval-icon" aria-hidden="true"><ShieldCheck size={19} weight="duotone" /></span>
        <div>
          {eyebrow && <p className="ask-approval-eyebrow">{eyebrow}</p>}
          <h3>{title}</h3>
        </div>
        <span className={`ask-approval-state is-${status}`}>
          {status === 'approved' ? <CheckCircle size={13} weight="fill" />
            : status === 'denied' ? <XCircle size={13} weight="fill" />
              : <Clock size={13} />}
          {statusLabel}
        </span>
      </header>

      <p className="ask-approval-summary">{summary}</p>
      <dl className="ask-approval-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className="ask-approval-disclosure"><ShieldCheck size={14} aria-hidden="true" />{disclosure}</p>

      {remoteDecision && !settled ? <p className="ask-approval-note">{closedLabel}</p> : settled ? (
        <p className="ask-approval-note" role="status">
          {status === 'approved' ? approvedLabel : status === 'denied' ? deniedLabel : closedLabel}
        </p>
      ) : (
        <div className="ask-approval-actions">
          <button
            type="button"
            className="btn"
            disabled={status === 'deciding'}
            onClick={() => onDecision('deny')}
          >
            {denyLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={status === 'deciding'}
            onClick={() => onDecision('approve')}
          >
            {approveLabel}
          </button>
        </div>
      )}
      {problem && <p className="ask-approval-problem" role="status">{problem}</p>}
    </section>
  );
}
