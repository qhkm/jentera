/* ============================================================
   What Jentera wants to do, waiting on a person.

   This is the screen the whole approval gate exists for. A reply to a
   customer goes out in the business's name, so the draft is editable
   before it is sent — and what the owner sends is what they saw, not
   what the model first wrote. An edit is recorded as `owner.edited`,
   which is the signal later phases mine to learn how this owner
   actually talks.

   Rejecting is as prominent as approving. A queue where the easy
   action is "yes" trains people to click yes.
   ============================================================ */

import { useState } from 'react';
import { Button, Card, Eyebrow, Tag } from '@/components/ui';
import { useRepository } from '@/lib/repo';
import type { Approval } from '@/lib/types';
import type { Tone } from '@/lib/types';

function riskTone(risk: string): Tone {
  return risk === 'high' ? 'red' : risk === 'medium' ? 'amber' : 'neutral';
}

/** The shape the Telegram reply flow puts in `args`. */
interface ReplyArgs {
  from?: string;
  question?: string;
  draft?: string;
}

function isReply(a: Approval): boolean {
  return a.conn === 'telegram' && a.op === 'send_message';
}

export default function ApprovalInbox({
  approvals,
  onDecided,
}: {
  approvals: Approval[];
  onDecided: () => void;
}) {
  if (approvals.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Eyebrow>Waiting for you</Eyebrow>
        <p className="max-w-[66ch] text-[13px] text-text-secondary">
          Nothing here has been sent. Jentera drafted it and stopped.
        </p>
      </div>
      {approvals.map((a) => (
        <Row key={a.remoteId ?? a.id} approval={a} onDecided={onDecided} />
      ))}
    </div>
  );
}

function Row({ approval, onDecided }: { approval: Approval; onDecided: () => void }) {
  const repo = useRepository();
  const args = (approval.args ?? {}) as ReplyArgs;
  const [draft, setDraft] = useState(args.draft ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edited = isReply(approval) && draft.trim() !== (args.draft ?? '').trim();

  async function decide(approved: boolean) {
    setBusy(true);
    setError(null);
    try {
      /* The edited text travels with the decision rather than being
         saved first. One call, so there is no state where the owner
         approved a draft that was then replaced by a half-finished
         edit. */
      await repo.decideApproval(approval.id, approved, edited ? draft.trim() : undefined);
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.');
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm">
            {isReply(approval)
              ? `Reply to ${args.from ?? 'a customer'} on Telegram`
              : `${approval.op} · ${approval.conn}`}
          </span>
          <span className="text-[11px] text-text-muted">
            {new Date(approval.ts).toLocaleString()}
          </span>
        </div>
        <Tag tone={riskTone(approval.risk)}>{approval.risk}</Tag>
      </div>

      {args.question && (
        <div className="flex flex-col gap-1 border-l-2 border-rail pl-3">
          <span className="text-[11px] uppercase tracking-wide text-text-muted">They asked</span>
          <span className="text-[13px] text-text-secondary">{args.question}</span>
        </div>
      )}

      {isReply(approval) ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wide text-text-muted">
            Jentera would send
          </span>
          <textarea
            className="input min-h-[5.5rem] w-full resize-y py-2 leading-snug"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="The reply Jentera will send"
            disabled={busy}
          />
          {edited && (
            <span className="text-[11px] text-text-muted">
              Edited — your wording will be sent, and Jentera will learn from the change.
            </span>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-text-secondary">
          {Object.entries(args)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join(' · ')}
        </p>
      )}

      {error && (
        <p role="alert" className="text-[12px] text-text-secondary">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {/* Equal weight. A queue whose easy action is "yes" teaches
            people to stop reading. */}
        <Button variant="outline" onClick={() => void decide(false)} disabled={busy}>
          Don&rsquo;t send
        </Button>
        <Button onClick={() => void decide(true)} disabled={busy || (isReply(approval) && !draft.trim())}>
          {busy ? 'Sending…' : edited ? 'Send my version' : 'Send it'}
        </Button>
      </div>
    </Card>
  );
}
