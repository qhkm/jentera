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

/**
 * Deliver what is due. One cross-tenant read of ids through the security
 * definer function, then every row is read and written inside its own
 * tenant. An owner with no devices counts as delivered: there was nothing
 * to send, and nothing to wait for.
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
      const row = await withTenant(env, target.business_id, async (tx) => {
        const [found] = await tx<OutboxRow[]>`
          select id, user_id, title, body, url, tag, attempts from push_outbox
           where id = ${target.outbox_id} and business_id = ${target.business_id} and delivered_at is null`;
        return found ?? null;
      });
      if (!row) continue;

      const result = await pushToUser(env, target.business_id, row.user_id, {
        title: row.title, body: row.body, url: row.url, ...(row.tag ? { tag: row.tag } : {}),
      }, { fetch: options.fetch });
      const attempts = row.attempts + 1;

      await withTenant(env, target.business_id, async (tx) => {
        if (result.failed === 0) {
          await tx`update push_outbox set attempts = ${attempts}, delivered_at = ${now.toISOString()}::timestamptz,
                          last_error = null
                    where id = ${row.id} and business_id = ${target.business_id}`;
          summary.delivered += 1;
        } else if (attempts >= PUSH_OUTBOX_MAX_ATTEMPTS) {
          await tx`update push_outbox set attempts = ${attempts},
                          last_error = ${`gave up after ${attempts} attempts; last: ${result.failed} device(s) failed`}
                    where id = ${row.id} and business_id = ${target.business_id}`;
          summary.gaveUp += 1;
        } else {
          const retryAt = new Date(now.getTime() + retryDelayMs(attempts));
          await tx`update push_outbox set attempts = ${attempts}, deliver_after = ${retryAt.toISOString()}::timestamptz,
                          last_error = ${`${result.failed} device(s) failed (push service error, e.g. 503); retry ${attempts + 1} scheduled`}
                    where id = ${row.id} and business_id = ${target.business_id}`;
          summary.retried += 1;
        }
      });
    } catch (error) {
      console.error(`[push-outbox] business=${target.business_id} row=${target.outbox_id} ${String(error)}`);
    }
  }
  return summary;
}
