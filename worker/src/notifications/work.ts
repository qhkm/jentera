/* Notifications about work someone asked for. The owners who did not ask are
   told when it waits on an owner. The person who asked is told too when they
   asked in the app — a chat they may have walked away from — and not for
   Telegram, which delivers its own reply and buttons, nor for routines, which
   have their own notifications. Each is told once per run and event. */
import type postgres from 'postgres';
import { can } from '../permissions';
import { createNotification } from './store';
import { ownersOf } from './recipients';

const NEEDS_OWNER = new Set(['needs_review', 'needs_input', 'blocked']);

/** A finished task is worth a push only once it took this long: by then the
    person who asked has likely put the phone down. Quick replies never push. */
export const FINISHED_PUSH_AFTER_SECONDS = 120;

interface Requester {
  requested_by: string | null;
  email: string | null;
  role: string | null;
  age_seconds: number;
}

async function requester(tx: postgres.TransactionSql, businessId: string, runId: string) {
  const [row] = await tx<Requester[]>`
    select r.requested_by, u.email, m.role,
           extract(epoch from (now() - r.created_at))::float8 as age_seconds
      from run r
      left join app_user u on u.id = r.requested_by
      left join membership m on m.user_id = r.requested_by and m.business_id = r.business_id
     where r.business_id = ${businessId} and r.id = ${runId}`;
  return row ?? null;
}

const who = (email: string | null) => (email ? email.split('@')[0] : 'A colleague');
const askedInApp = (channel: string | null | undefined) => channel === 'app';
const reviewUrl = (runId: string) => `/app?view=work&review=${runId}`;

/** A task ended waiting on an owner: the owners who did not ask, and the
    person who asked in the app when they can act on it. */
export async function notifyOwnersWorkNeedsYou(
  tx: postgres.TransactionSql,
  businessId: string,
  input: { runId: string; status: string; objective: string; channel?: string | null },
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
  const note = (recipientUserId: string, body: string) => createNotification(tx, businessId, {
    recipientUserId,
    kind: 'work_needs_you',
    title: `${objective} — needs you`,
    body,
    sourceKey: `${input.runId}:work_needs_you`,
    runId: input.runId,
    url: reviewUrl(input.runId),
  });
  let sent = 0;
  for (const owner of owners) {
    if (await note(owner, `${who(asked.email)} asked for this. ${detail}`)) sent += 1;
  }
  /* Anyone can answer for their own task; confirming a result or unblocking
     one is an owner's decision. */
  const canAct = input.status === 'needs_input' || can(asked, 'tasks.review');
  if (askedInApp(input.channel) && canAct &&
      await note(asked.requested_by, `You asked for this. ${detail}`)) sent += 1;
  return sent;
}

/** An action awaits an owner's decision: the owners who did not ask, and the
    owner who asked in the app. The wait is short, so it is sent at once
    (`deliverPendingPushes`) rather than at the next cron tick. */
export async function notifyOwnersApprovalRequested(
  tx: postgres.TransactionSql,
  businessId: string,
  input: { runId: string; objective: string; channel?: string | null },
): Promise<number> {
  const asked = await requester(tx, businessId, input.runId);
  if (!asked?.requested_by) return 0;
  const owners = await ownersOf(tx, businessId, { except: asked.requested_by });
  const objective = input.objective.trim().slice(0, 100) || 'An action';
  const note = (recipientUserId: string, body: string) => createNotification(tx, businessId, {
    recipientUserId,
    kind: 'approval_requested',
    title: `${objective} — approval needed`,
    body,
    sourceKey: `${input.runId}:approval_requested`,
    runId: input.runId,
    url: reviewUrl(input.runId),
  });
  let sent = 0;
  for (const owner of owners) {
    if (await note(owner, `${who(asked.email)} asked for this. Open the task to approve or decline.`)) sent += 1;
  }
  if (askedInApp(input.channel) && can(asked, 'approvals.decide') &&
      await note(asked.requested_by, 'You asked for this. Open the task to approve or decline; it will not wait long.')) {
    sent += 1;
  }
  return sent;
}

/** A work task asked for in the app finished or failed, long enough after it
    was asked that the person has likely stopped watching. Only they are told:
    the result is theirs, and the other owners see it in Activity. */
export async function notifyRequesterWorkFinished(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    runId: string;
    status: 'completed' | 'failed';
    objective: string;
    channel?: string | null;
    kind: 'work' | 'conversation';
  },
): Promise<number> {
  if (!askedInApp(input.channel) || input.kind !== 'work') return 0;
  const asked = await requester(tx, businessId, input.runId);
  if (!asked?.requested_by || asked.age_seconds < FINISHED_PUSH_AFTER_SECONDS) return 0;
  const objective = input.objective.trim().slice(0, 100) || 'Your task';
  const failed = input.status === 'failed';
  const created = await createNotification(tx, businessId, {
    recipientUserId: asked.requested_by,
    kind: 'work_finished',
    title: `${objective} — ${failed ? 'could not finish' : 'done'}`,
    body: failed ? 'Open it to see what happened.' : 'Open it to see the result.',
    sourceKey: `${input.runId}:work_finished`,
    runId: input.runId,
    url: reviewUrl(input.runId),
  });
  return created ? 1 : 0;
}
