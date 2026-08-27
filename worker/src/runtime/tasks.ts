import type postgres from 'postgres';

export const RUNTIME_TASK_KINDS = [
  'provision',
  'run',
  'resume',
  'reconcile',
  'upgrade',
  'delete',
  'cancel',
] as const;

export type RuntimeTaskKind = (typeof RUNTIME_TASK_KINDS)[number];
export type RuntimeTaskStatus =
  | 'queued'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'exhausted';

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
  remoteRunId: string | null;
  remoteStatus: string | null;
  result: unknown;
  startedAt: Date | null;
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
  remote_run_id: string | null;
  remote_status: string | null;
  result: unknown;
  started_at: Date | null;
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
  remoteRunId: row.remote_run_id,
  remoteStatus: row.remote_status,
  result: row.result,
  startedAt: row.started_at,
});

const cols = `id, business_id, run_id, kind, status, payload, dedupe_key,
              attempt, lease_token, lease_expires_at, remote_run_id,
              remote_status, result, started_at`;

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

export async function runtimeTaskByDedupeKey(
  tx: postgres.TransactionSql,
  businessId: string,
  dedupeKey: string,
): Promise<RuntimeTask | null> {
  const [row] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where business_id = ${businessId} and dedupe_key = ${dedupeKey}`;
  return row ? task(row) : null;
}

export async function runtimeTaskForRun(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
): Promise<RuntimeTask | null> {
  const [row] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where business_id = ${businessId} and run_id = ${runId}
     order by created_at desc limit 1`;
  return row ? task(row) : null;
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
       set status = 'failed', lease_token = null, lease_expires_at = null,
           attempt = attempt + 1, available_at = now(),
           last_error = 'lease expired', updated_at = now()
     where business_id = ${businessId} and status = 'leased'
       and lease_expires_at <= now()`;

  const [current] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where id = ${taskId} and business_id = ${businessId} for update`;
  if (!current) return { outcome: 'missing' };
  if (current.status === 'completed' || current.status === 'cancelled' ||
      current.status === 'exhausted') {
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
           last_error = null, updated_at = now()
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
  detail: { remoteRunId?: string; remoteStatus?: string; result?: unknown } = {},
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'completed', lease_token = null, lease_expires_at = null,
           remote_run_id = coalesce(${detail.remoteRunId ?? null}, remote_run_id),
           remote_status = coalesce(${detail.remoteStatus ?? null}, remote_status),
           result = ${detail.result === undefined ? tx`result` : tx.json(detail.result as never)},
           completed_at = now(), updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

/** Release a healthy in-flight remote task and ask Queue to poll it later. */
export async function deferRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  detail: { remoteRunId: string; remoteStatus: string; delaySeconds?: number },
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'queued', lease_token = null, lease_expires_at = null,
           remote_run_id = ${detail.remoteRunId}, remote_status = ${detail.remoteStatus},
           started_at = coalesce(started_at, now()),
           available_at = now() + (${detail.delaySeconds ?? 5} * interval '1 second'),
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

/** Persist the remote identity before the first status poll. A timeout after
    Hermes accepts work must never leave an unaddressable paid run. */
export async function recordRuntimeTaskRemoteRun(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  remoteRunId: string,
  remoteStatus: string,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set remote_run_id = ${remoteRunId}, remote_status = ${remoteStatus},
           started_at = coalesce(started_at, now()), updated_at = now()
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
           attempt = attempt + 1,
           available_at = now() + (${delaySeconds} * interval '1 second'),
           last_error = ${error.slice(0, 1000)}, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

/** Terminal failure. Queue redelivery becomes a harmless acknowledgement. */
export async function exhaustRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  error: string,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'exhausted', lease_token = null, lease_expires_at = null,
           attempt = attempt + 1,
           last_error = ${error.slice(0, 1000)}, completed_at = now(), updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

export async function cancelRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
): Promise<{ task: RuntimeTask; changed: boolean } | null> {
  const [current] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where id = ${taskId} and business_id = ${businessId} for update`;
  if (!current) return null;
  if (['completed', 'cancelled', 'exhausted'].includes(current.status)) {
    return { task: task(current), changed: false };
  }
  const [cancelled] = await tx<TaskRow[]>`
    update runtime_task
       set status = 'cancelled', lease_token = null, lease_expires_at = null,
           completed_at = now(), updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
    returning ${tx.unsafe(cols)}`;
  return { task: task(cancelled), changed: true };
}

export async function runtimeTaskIsCancelled(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
): Promise<boolean> {
  const [row] = await tx<{ cancelled: boolean }[]>`
    select status = 'cancelled' as cancelled from runtime_task
     where id = ${taskId} and business_id = ${businessId}`;
  return row?.cancelled ?? false;
}
