import type postgres from 'postgres';
import type { Env } from '../env';
import { withUser } from '../db';
import { notifySparePool } from './spare-alerts';

export interface RuntimeSpare {
  spare_id: string;
  provider_name: string;
  provider_id: string;
  provider_url: string;
  release: string;
  bundle_commit: string;
}

export interface SpareQueueMessage {
  version: 3;
  kind: 'prepare_spare';
  spareId: string;
}

export interface SpareRetirementQueueMessage {
  version: 3;
  kind: 'retire_spare';
  spareId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A disabled pool neither queries inventory nor creates provider resources. */
export function sparePoolConfig(env: Env): { release: string; bundle: string; target: number } | null {
  const target = env.RUNTIME_SPARE_POOL_TARGET ?? '2';
  if (env.RUNTIME_SPARE_POOL_ENABLED !== 'true' || !/^[12]$/.test(target) ||
      env.RUNTIME_PROVISIONING_ENABLED !== 'true' || env.RUNTIME_BOOTSTRAP_ENABLED !== 'true' ||
      env.MODEL_TRANSPORT_READY !== 'true' || !env.SPRITES_TOKEN || !env.RUNTIME_QUEUE ||
      !/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+$/.test(env.RUNTIME_RELEASE ?? '') ||
      !/^[0-9a-f]{40}$/.test(env.RUNTIME_BUNDLE_COMMIT ?? '')) return null;
  return { release: env.RUNTIME_RELEASE!, bundle: env.RUNTIME_BUNDLE_COMMIT!, target: Number(target) };
}

export function validSpareMessage(message: SpareQueueMessage): boolean {
  return message.kind === 'prepare_spare' && typeof message.spareId === 'string' && UUID.test(message.spareId);
}

/** No business argument: SQL derives it from withTenant's transaction GUC. */
export async function claimSpare(tx: postgres.TransactionSql, config: { release: string; bundle: string }) {
  const [spare] = await tx<RuntimeSpare[]>`
    select * from public.claim_runtime_spare(${config.release},${config.bundle})`;
  return spare ?? null;
}

export async function assignedSpare(tx: postgres.TransactionSql, name: string) {
  const [spare] = await tx<RuntimeSpare[]>`select * from public.assigned_runtime_spare(${name})`;
  return spare ?? null;
}

/** Cron re-publishes queued ids until leased; a failed publish loses nothing. */
export async function refillSparePool(env: Env): Promise<number> {
  const config = sparePoolConfig(env);
  if (!config) return 0;
  const rows = await withUser(env, sql => sql<{ spare_id: string }[]>`
    select * from public.queue_runtime_spares(${config.release},${config.bundle},${config.target})`);
  if (env.RUNTIME_SPARE_POOL_RECOVERY_ENABLED === 'true') {
    const obsolete = await withUser(env, sql => sql<{ spare_id: string }[]>`
      select * from public.runtime_spare_retirement_candidates()`);
    for (const row of obsolete) {
      await env.RUNTIME_QUEUE!.send({ version: 3, kind: 'retire_spare', spareId: row.spare_id });
    }
    await notifySparePool(env, config);
  }
  for (const row of rows) {
    await env.RUNTIME_QUEUE!.send({ version: 3, kind: 'prepare_spare', spareId: row.spare_id });
  }
  const [review] = await withUser(env, sql => sql<{ count: number }[]>`
    select public.runtime_spare_review_count() as count`);
  if (review?.count) console.warn(`[runtime-spares] reviewRequired=${review.count}; failed/stale inventory holds its budget`);
  return rows.length;
}
