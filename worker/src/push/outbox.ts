import type postgres from 'postgres';
import type { Env } from '../env';
import { connect, withTenant } from '../db';
import { pushConfigured, pushToUser, type FetchLike, type PushPayload } from './send';

/** After this many failed attempts a row is left with its error and no
    further tries: eight, with doubling delays, is about two hours. */
export const PUSH_OUTBOX_MAX_ATTEMPTS = 8;
const SCAN_LIMIT = 100;

export interface SweepSummary {
  delivered: number;
  retried: number;
  gaveUp: number;
}

/**
 * Queue a push for one owner, inside the caller's tenant transaction, so it
 * commits or rolls back with the notification it mirrors. The cron sends it
 * within a minute. `url` is where a tap lands, a path inside the app.
 */
export async function enqueuePush(
  tx: postgres.TransactionSql,
  businessId: string,
  userId: string,
  payload: PushPayload,
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into push_outbox (business_id, user_id, title, body, url, tag)
    values (${businessId}, ${userId}, ${payload.title.slice(0, 160)}, ${payload.body.slice(0, 500)},
            ${payload.url ?? '/app'}, ${payload.tag?.slice(0, 200) ?? null})
    returning id`;
  return row.id;
}

/** Doubling from one minute, capped at an hour. */
function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** (attempts - 1)) * 60_000;
}

interface OutboxRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  url: string;
  tag: string | null;
  attempts: number;
}

/** How long a claimed row is hidden from every other sender while one sends
    it. A sender that dies mid-send leaves the row due again after this. */
const CLAIM_MS = 2 * 60_000;

/**
 * Take a due row for sending, or nothing if another sender has it. Moving
 * `deliver_after` past the present is the claim: the due scan skips the row,
 * and a second claim finds it not due. So the cron and an immediate send
 * racing for the same row send it once. `at` is the present as the caller
 * sees it; null means the database's own clock.
 */
async function claimRow(
  tx: postgres.TransactionSql,
  businessId: string,
  outboxId: string,
  at: Date | null,
): Promise<OutboxRow | null> {
  const present = at ? tx`${at.toISOString()}::timestamptz` : tx`now()`;
  const [row] = await tx<OutboxRow[]>`
    update push_outbox
       set deliver_after = ${present} + make_interval(secs => ${CLAIM_MS / 1000})
     where id = ${outboxId} and business_id = ${businessId}
       and delivered_at is null
       and deliver_after <= ${present}
       and attempts < ${PUSH_OUTBOX_MAX_ATTEMPTS}
    returning id, user_id, title, body, url, tag, attempts`;
  return row ?? null;
}

/** Send one claimed row and record what happened, into `summary`. */
async function sendClaimed(
  env: Env,
  businessId: string,
  row: OutboxRow,
  now: Date,
  summary: SweepSummary,
  fetch: FetchLike | undefined,
): Promise<void> {
  const result = await pushToUser(env, businessId, row.user_id, {
    title: row.title, body: row.body, url: row.url, ...(row.tag ? { tag: row.tag } : {}),
  }, { fetch });
  const attempts = row.attempts + 1;

  await withTenant(env, businessId, async (tx) => {
    if (result.failed === 0) {
      await tx`update push_outbox set attempts = ${attempts}, delivered_at = ${now.toISOString()}::timestamptz,
                      last_error = null
                where id = ${row.id} and business_id = ${businessId}`;
      summary.delivered += 1;
    } else if (attempts >= PUSH_OUTBOX_MAX_ATTEMPTS) {
      await tx`update push_outbox set attempts = ${attempts},
                      last_error = ${`gave up after ${attempts} attempts; last: ${result.failed} device(s) failed`}
                where id = ${row.id} and business_id = ${businessId}`;
      summary.gaveUp += 1;
    } else {
      const retryAt = new Date(now.getTime() + retryDelayMs(attempts));
      await tx`update push_outbox set attempts = ${attempts}, deliver_after = ${retryAt.toISOString()}::timestamptz,
                      last_error = ${`${result.failed} device(s) failed (push service error, e.g. 503); retry ${attempts + 1} scheduled`}
                where id = ${row.id} and business_id = ${businessId}`;
      summary.retried += 1;
    }
  });
}

/**
 * Deliver what is due. One cross-tenant read of ids through the security
 * definer function, then every row is claimed, sent and recorded inside its
 * own tenant. An owner with no devices counts as delivered: there was
 * nothing to send, and nothing to wait for.
 */
export async function sweepPushOutbox(
  env: Env,
  options: { fetch?: FetchLike; now?: Date; limit?: number } = {},
): Promise<SweepSummary> {
  const summary: SweepSummary = { delivered: 0, retried: 0, gaveUp: 0 };
  if (!pushConfigured(env)) return summary;
  const now = options.now ?? new Date();

  const sql = connect(env);
  let targets: { business_id: string; outbox_id: string }[];
  try {
    targets = await sql<{ business_id: string; outbox_id: string }[]>`
      select business_id, outbox_id
        from public.push_outbox_due(${now.toISOString()}::timestamptz, ${options.limit ?? SCAN_LIMIT})`;
  } finally {
    await sql.end();
  }

  for (const target of targets) {
    try {
      const row = await withTenant(env, target.business_id,
        (tx) => claimRow(tx, target.business_id, target.outbox_id, now));
      if (!row) continue;
      await sendClaimed(env, target.business_id, row, now, summary, options.fetch);
    } catch (error) {
      console.error(`[push-outbox] business=${target.business_id} row=${target.outbox_id} ${String(error)}`);
    }
  }
  return summary;
}

/**
 * Deliver one business's due pushes now, rather than at the next cron tick.
 * For what cannot wait a minute — an approval that expires in about one.
 * Called after the transaction that queued them commits; it never throws, and
 * whatever it does not deliver the cron still will.
 *
 * Due means due by the database's clock, which is the clock that stamped
 * the rows: judged by this Worker's clock instead, a database running a few
 * hundred milliseconds ahead would make every just-queued push look early,
 * and this would quietly send nothing.
 */
export async function deliverPendingPushes(
  env: Env,
  businessId: string,
  options: { fetch?: FetchLike; now?: Date } = {},
): Promise<SweepSummary> {
  const summary: SweepSummary = { delivered: 0, retried: 0, gaveUp: 0 };
  if (!pushConfigured(env)) return summary;
  const now = options.now ?? new Date();
  const at = options.now ?? null;
  try {
    const rows = await withTenant(env, businessId, async (tx) => {
      const present = at ? tx`${at.toISOString()}::timestamptz` : tx`now()`;
      const due = await tx<{ id: string }[]>`
        select id from push_outbox
         where business_id = ${businessId} and delivered_at is null
           and deliver_after <= ${present}
           and attempts < ${PUSH_OUTBOX_MAX_ATTEMPTS}
         order by deliver_after, id
         limit ${SCAN_LIMIT}`;
      const claimed: OutboxRow[] = [];
      for (const { id } of due) {
        const row = await claimRow(tx, businessId, id, at);
        if (row) claimed.push(row);
      }
      return claimed;
    });
    for (const row of rows) {
      try {
        await sendClaimed(env, businessId, row, now, summary, options.fetch);
      } catch (error) {
        console.error(`[push-outbox] business=${businessId} row=${row.id} ${String(error)}`);
      }
    }
  } catch (error) {
    console.error(`[push-outbox] business=${businessId} immediate delivery failed: ${String(error)}`);
  }
  return summary;
}
