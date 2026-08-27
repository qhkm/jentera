import type postgres from 'postgres';

export const RUNTIME_TASK_KINDS = [
  'provision',
  'run',
  'resume',
  'reconcile',
  'upgrade',
  'delete',
] as const;

export type RuntimeTaskKind = (typeof RUNTIME_TASK_KINDS)[number];
export type RuntimeTaskStatus = 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled';

export interface RuntimeTask {
  id: string;
  businessId: string;
  runId: string | null;
  kind: RuntimeTaskKind;
  status: RuntimeTaskStatus;
  payload: unknown;
  dedupeKey: string;
  attempt: number;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

interface TaskRow {
  id: string;
  business_id: string;
  run_id: string | null;
  kind: RuntimeTaskKind;
  status: RuntimeTaskStatus;
  payload: unknown;
  dedupe_key: string;
  attempt: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
}

const task = (row: TaskRow): RuntimeTask => ({
  id: row.id,
  businessId: row.business_id,
  runId: row.run_id,
  kind: row.kind,
  status: row.status,
  payload: row.payload,
  dedupeKey: row.dedupe_key,
  attempt: row.attempt,
  leaseToken: row.lease_token,
  leaseExpiresAt: row.lease_expires_at,
});

const cols = `id, business_id, run_id, kind, status, payload, dedupe_key,
              attempt, lease_token, lease_expires_at`;

export async function enqueueRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    kind: RuntimeTaskKind;
    runId?: string | null;
    payload?: unknown;
    dedupeKey: string;
  },
): Promise<RuntimeTask> {
  const [row] = await tx<TaskRow[]>`
    insert into runtime_task (business_id, run_id, kind, payload, dedupe_key)
    values (${businessId}, ${input.runId ?? null}, ${input.kind},
            ${tx.json((input.payload ?? {}) as never)}, ${input.dedupeKey})
    on conflict (business_id, dedupe_key) do update
      set updated_at = runtime_task.updated_at
    returning ${tx.unsafe(cols)}`;
  return task(row);
}

export type LeaseResult =
  | { outcome: 'leased'; task: RuntimeTask }
  | { outcome: 'busy' }
  | { outcome: 'done' }
  | { outcome: 'missing' };

export async function leaseRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  leaseSeconds = 300,
): Promise<LeaseResult> {
  /* Expired work is recoverable. Clear it before the unique active-
     lease index decides whether this business may start something. */
  await tx`
    update runtime_task
       set status = 'queued', lease_token = null, lease_expires_at = null,
           last_error = 'lease expired', updated_at = now()
     where business_id = ${businessId} and status = 'leased'
       and lease_expires_at <= now()`;

  const [current] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where id = ${taskId} and business_id = ${businessId} for update`;
  if (!current) return { outcome: 'missing' };
  if (current.status === 'completed' || current.status === 'cancelled') {
    return { outcome: 'done' };
  }
  if (current.status === 'leased') return { outcome: 'busy' };

  const [other] = await tx<{ id: string }[]>`
    select id from runtime_task
     where business_id = ${businessId} and status = 'leased' and id <> ${taskId}
     limit 1`;
  if (other) return { outcome: 'busy' };

  const [leased] = await tx<TaskRow[]>`
    update runtime_task
       set status = 'leased', lease_token = ${leaseToken},
           lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
           attempt = attempt + 1, last_error = null, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status in ('queued','failed') and available_at <= now()
    returning ${tx.unsafe(cols)}`;
  return leased ? { outcome: 'leased', task: task(leased) } : { outcome: 'busy' };
}

export async function completeRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'completed', lease_token = null, lease_expires_at = null,
           completed_at = now(), updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

export async function retryRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  error: string,
  delaySeconds = 30,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'failed', lease_token = null, lease_expires_at = null,
           available_at = now() + (${delaySeconds} * interval '1 second'),
           last_error = ${error.slice(0, 1000)}, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}
