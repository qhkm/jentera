import type { Env } from '../env';
import { withUser } from '../db';
import { sendNotice } from '../email';

export interface SpareHealth {
  ready: number; queued: number; preparing: number; quarantined: number;
  review_required: number; created_last_hour: number; empty_since?: Date | null;
}
/** Aggregates only: no business identity, credentials, files or provider errors. */
export async function notifySparePool(env: Env, config: { release: string; bundle: string; target: number }): Promise<void> {
  const to = env.SIGNUP_NOTICE_TO?.trim();
  if (!to || !env.RESEND_API_KEY) {
    console.warn('[runtime-spares] operator alert delivery unavailable');
    return;
  }
  const token = crypto.randomUUID();
  const [health] = await withUser(env, sql => sql<SpareHealth[]>`
    select * from public.lease_runtime_spare_alert(${config.release},${config.bundle},${config.target},${token})`);
  if (!health) return;
  let sent = false;
  try {
    sent = await sendNotice(env, to, 'Jentera spare pool needs attention', [
      `Runtime release: ${config.release}`,
      `Desired spare inventory: ${config.target}; ready: ${health.ready}; queued: ${health.queued}; preparing: ${health.preparing}.`,
      `Quarantined: ${health.quarantined}; requiring manual review: ${health.review_required}.`,
      `New pool preparations in the last hour: ${health.created_last_hour} / 4.`,
      'The pool is empty for at least ten minutes or cleanup needs manual review.',
      'Customer signups retain normal cold provisioning. Assigned customer Sprites are never recycled.',
      'Inspect docs/runtime-spare-pool.md. Do not retire inventory before confirming the exact unused provider resource is absent.',
    ].join('\n'), undefined, undefined, { timeoutMs: 8_000 });
  } catch { console.warn('[runtime-spares] operator alert failed; retry scheduled'); }
  await withUser(env, sql => sql`select public.finish_runtime_spare_alert(${token},${sent})`);
}
