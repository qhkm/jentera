import { Check, Clock, FileText, ShieldCheck } from '@phosphor-icons/react';
import { JenteraMark } from '@/components/JenteraMark';

/** Illustrative drafts, never presented as live customer activity. */
export function WorkIllustration({ kind }: { kind: 'chat' | 'document' | 'search' | 'shield' }) {
  return (
    <div className={`work-illustration work-illustration-${kind}`}>
      <span className="illustration-label">Example</span>
      {kind === 'chat' ? (
        <>
          <div className="sample-message sample-message-customer">
            <span>
              Customer enquiry <small>10:42 pm</small>
            </span>
            <p>Hi, can order lunch for 30 pax this Friday?</p>
          </div>
          <div className="sample-message sample-message-jentera">
            <span>
              <JenteraMark size={22} /> Reply draft
            </span>
            <p>
              Hi! Yes, we do catering. What time would you like lunch, and where is the delivery?
            </p>
            <small>
              <Check size={12} aria-hidden="true" /> Ready for your review
            </small>
          </div>
        </>
      ) : kind === 'document' ? (
        <div className="sample-checklist">
          <div>
            <FileText size={20} weight="duotone" aria-hidden="true" />
            <strong>Friday’s catering order</strong>
          </div>
          <p>
            <Check size={15} aria-hidden="true" /> Menu details organised
          </p>
          <p>
            <Check size={15} aria-hidden="true" /> Prep checklist drafted
          </p>
          <p className="sample-waiting">
            <Clock size={15} aria-hidden="true" /> Confirm final guest count
          </p>
        </div>
      ) : kind === 'search' ? (
        <div className="sample-report">
          <div>
            <FileText size={20} weight="duotone" aria-hidden="true" />
            <strong>Your weekly summary</strong>
            <span>Draft</span>
          </div>
          <p>
            Orders, stock notes and follow-ups.
            <br />
            All in one place for you to check.
          </p>
          <div className="sample-report-lines" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className="sample-report-foot">
            <Check size={13} aria-hidden="true" /> Based on the notes you shared
          </span>
        </div>
      ) : (
        <div className="sample-approval">
          <span className="sample-approval-icon">
            <ShieldCheck size={32} weight="duotone" aria-hidden="true" />
          </span>
          <div>
            <strong>The decision is yours.</strong>
            <p>
              Check the draft. Make a change.
              <br />
              Decide when it’s ready.
            </p>
            <span className="sample-waiting">
              <Clock size={13} aria-hidden="true" /> Waiting for your review
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
