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

/** Latest cancellable run belonging to one Telegram chat. */
export async function activeRuntimeRunTask(
  tx: postgres.TransactionSql,
  businessId: string,
  chatId: number,
): Promise<RuntimeTask | null> {
  const [row] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where business_id = ${businessId}
       and kind = 'run'
       and status in ('queued', 'leased', 'failed')
       and payload #>> '{telegram,chatId}' = ${String(chatId)}
     order by created_at desc
     limit 1`;
  return row ? task(row) : null;
}

export type LeaseResult =
  | { outcome: 'leased'; task: RuntimeTask }
  | { outcome: 'busy'; siblingLeaseExpiresAt: Date | null }
  | { outcome: 'done' }
  | { outcome: 'missing' };

export async function leaseRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  leaseSeconds = 300,
): Promise<LeaseResult> {
  /* Serialize the lease decision on a tenant-scoped advisory key instead of
     the business row. Same mutual exclusion — two concurrent Queue deliveries
     for different tasks of one business can otherwise both pass the pre-checks
     and trip the partial unique index — but advisory locks live in shared
     memory, don't lock the parent row, and skip a business-table round trip.
     Existence is derived from the task row below. */
  await tx`select pg_advisory_xact_lock(hashtextextended(${businessId}::text, 0))`;

  /* Expired work is recoverable. Clear it before the unique active-
     lease index decides whether this business may start something. */
  await tx`
    update runtime_task
       set status = 'failed', lease_token = null, lease_expires_at = null,
           attempt = attempt + 1, available_at = now(),
           last_error = 'lease expired', updated_at = now()
     where business_id = ${businessId} and status = 'leased'
       and lease_expires_at <= now()`;

  /* Try the common success path directly. UPDATE provides the row lock; the
     business advisory lock already serialises competing lease decisions, so
     a preceding SELECT ... FOR UPDATE was one full Neon round trip with no
     additional safety. */
  const [leased] = await tx<TaskRow[]>`\n    update runtime_task\n       set status = 'leased', lease_token = ${leaseToken},\n           lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),\n           last_error = null, updated_at = now()\n     where id = ${taskId} and business_id = ${businessId}\n       and status in ('queued','failed') and available_at <= now()\n       and not exists (\n         select 1 from runtime_task sibling\n          where sibling.business_id = ${businessId}\n            and sibling.status = 'leased'\n            and sibling.id <> ${taskId}\n       )\n    returning ${tx.unsafe(cols)}`;
  if (leased) return { outcome: 'leased', task: task(leased) };

  /* The uncommon fallback distinguishes a terminal/missing duplicate from a
     task parked behind the active lease, in one query. */
  const [state] = await tx<{
    status: RuntimeTaskStatus | null;
    current_lease_expires_at: Date | null;
    sibling_lease_expires_at: Date | null;
  }[]>`
    select current.status,
           current.lease_expires_at as current_lease_expires_at,
           sibling.lease_expires_at as sibling_lease_expires_at
      from (select 1) gate
      left join runtime_task current
        on current.id = ${taskId} and current.business_id = ${businessId}
      left join lateral (
        select lease_expires_at
          from runtime_task
         where business_id = ${businessId} and status = 'leased'
         order by updated_at desc
         limit 1
      ) sibling on true`;
  if (!state?.status) return { outcome: 'missing' };
  if (state.status === 'completed' || state.status === 'cancelled' ||
      state.status === 'exhausted') {
    return { outcome: 'done' };
  }
  return {
    outcome: 'busy',
    siblingLeaseExpiresAt: state.status === 'leased'
      ? state.current_lease_expires_at
      : state.sibling_lease_expires_at,
  };
}

/** Oldest task still waiting for a free slot — the FIFO next-in-line.
    Hermes-style: a new message queues behind whatever is already ahead. */
export async function nextWaitingRuntimeTaskId(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    select id
      from runtime_task
     where business_id = ${businessId}
       and status in ('queued', 'failed')
       and available_at <= now()
     order by created_at asc, id asc
     limit 1`;
  return row?.id ?? null;
}

/** Number of active-or-waiting tasks strictly older than taskId.
    >0 means the task that just arrived is behind at least the running
    one (#ahead + 1 = position in line). */
export async function runtimeQueuePosition(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
): Promise<number> {
  const [row] = await tx<{ ahead: number }[]>`
    select count(*)::int as ahead
      from runtime_task
     where business_id = ${businessId}
       and status in ('queued', 'failed', 'leased')
       and (created_at, id) < (
         select created_at, id
           from runtime_task
          where business_id = ${businessId} and id = ${taskId}
       )`;
  return row?.ahead ?? 0;
}

export async function completeRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  detail: {
    remoteRunId?: string;
    remoteStatus?: string;
    result?: unknown;
    scrubPayload?: boolean;
  } = {},
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'completed', lease_token = null, lease_expires_at = null,
           remote_run_id = coalesce(${detail.remoteRunId ?? null}, remote_run_id),
           remote_status = coalesce(${detail.remoteStatus ?? null}, remote_status),
           result = ${detail.result === undefined ? tx`result` : tx.json(detail.result as never)},
           payload = ${detail.scrubPayload ? tx.json({} as never) : tx`payload`},
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
  detail: { remoteRunId?: string; remoteStatus?: string; delaySeconds?: number },
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'queued', lease_token = null, lease_expires_at = null,
           remote_run_id = coalesce(${detail.remoteRunId ?? null}, remote_run_id),
           remote_status = coalesce(${detail.remoteStatus ?? null}, remote_status),
           started_at = coalesce(started_at, now()),
           available_at = now() + (${detail.delaySeconds ?? 5} * interval '1 second'),
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

/** Keep ownership while one Worker invocation consumes an ephemeral runtime
    stream. A dead invocation stops renewing and becomes recoverable normally. */
export async function renewRuntimeTaskLease(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  leaseSeconds = 300,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
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
  scrubPayload = false,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'exhausted', lease_token = null, lease_expires_at = null,
           attempt = attempt + 1,
           payload = ${scrubPayload ? tx.json({} as never) : tx`payload`},
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
