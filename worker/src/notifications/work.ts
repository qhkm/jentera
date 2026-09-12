/* Notifications about a colleague's work. The run knows who asked; the
   owners minus that person are told, once per run and event. */
import type postgres from 'postgres';
import { createNotification } from './store';
import { ownersOf } from './recipients';

const NEEDS_OWNER = new Set(['needs_review', 'needs_input', 'blocked']);

async function requester(tx: postgres.TransactionSql, businessId: string, runId: string) {
  const [row] = await tx<{ requested_by: string | null; email: string | null }[]>`
    select r.requested_by, u.email from run r left join app_user u on u.id = r.requested_by
     where r.business_id = ${businessId} and r.id = ${runId}`;
  return row ?? null;
}

const who = (email: string | null) => (email ? email.split('@')[0] : 'A colleague');

/** A task asked for by someone else ended waiting on the owner. */
export async function notifyOwnersWorkNeedsYou(
  tx: postgres.TransactionSql,
  businessId: string,
  input: { runId: string; status: string; objective: string },
): Promise<number> {
  if (!NEEDS_OWNER.has(input.status)) return 0;
  const asked = await requester(tx, businessId, input.runId);
  if (!asked?.requested_by) return 0;
  const owners = await ownersOf(tx, businessId, { except: asked.requested_by });
  const objective = input.objective.trim().slice(0, 100) || 'A task';
  const detail = input.status === 'needs_review'
    ? 'The result is ready and needs your confirmation.'
    : input.status === 'needs_input'
      ? 'Jentera needs details or authorisation only you can give.'
      : 'Jentera could not continue without you.';
  let sent = 0;
  for (const owner of owners) {
    if (await createNotification(tx, businessId, {
      recipientUserId: owner,
      kind: 'work_needs_you',
      title: `${objective} — needs you`,
      body: `${who(asked.email)} asked for this. ${detail}`,
      sourceKey: `${input.runId}:work_needs_you`,
      runId: input.runId,
      url: `/app?view=work&review=${input.runId}`,
    })) sent += 1;
  }
  return sent;
}

/** An action asked for by someone else awaits an owner's decision. */
export async function notifyOwnersApprovalRequested(
  tx: postgres.TransactionSql,
  businessId: string,
  input: { runId: string; objective: string; summary?: string | null },
): Promise<number> {
  const asked = await requester(tx, businessId, input.runId);
  if (!asked?.requested_by) return 0;
  const owners = await ownersOf(tx, businessId, { except: asked.requested_by });
  const objective = input.objective.trim().slice(0, 100) || 'An action';
  let sent = 0;
  for (const owner of owners) {
    if (await createNotification(tx, businessId, {
      recipientUserId: owner,
      kind: 'approval_requested',
      title: `${objective} — approval needed`,
      body: `${who(asked.email)} asked for this. ${(input.summary ?? '').trim().slice(0, 300) || 'Open the task to approve or decline.'}`,
      sourceKey: `${input.runId}:approval_requested`,
      runId: input.runId,
      url: `/app?view=work&review=${input.runId}`,
    })) sent += 1;
  }
  return sent;
}
