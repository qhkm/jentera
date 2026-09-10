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

export const RUNTIME_LEASE_SECONDS = 300;
const RUNTIME_LEASE_STALE_SECONDS = 60;

export type RuntimeTaskKind = (typeof RUNTIME_TASK_KINDS)[number];
export type RuntimeTaskStatus =
  | 'queued'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'exhausted';

export type RuntimeTaskDispatchPhase =
  | 'not_dispatched'
  | 'ambiguously_dispatched'
  | 'remotely_running';

export type RuntimeTaskCancelState = 'none' | 'requested' | 'confirmed' | 'failed';

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
  leaseHeartbeatAt: Date | null;
  dispatchPhase: RuntimeTaskDispatchPhase;
  cancelState: RuntimeTaskCancelState;
  remoteRunId: string | null;
  remoteStatus: string | null;
  result: unknown;
  startedAt: Date | null;
  /** Last runner event seq a slice relayed; the next slice skips the replay. */
  streamSeq: number;
}

export interface RuntimeTaskTerminalOutcome {
  remoteStatus: string;
  result: unknown;
  reasoning?: unknown;
  summary: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export type RuntimeApprovalStatus =
  | 'pending'
  | 'deciding'
  | 'approved'
  | 'denied'
  | 'expired';

/**
 * A pause waiting on a person.
 *
 * `surface` is the change that lets a web run have one at all. Until now the
 * shape assumed Telegram — connectionId, chatId, messageId, all required —
 * so an approval on any other channel could not be represented, and the
 * consumer threw rather than parking it. A thrown approval is not a lost
 * approval; it is a lost run.
 *
 * Rows written before this change have those three fields flat and no
 * `surface`. The validator reads both and writes only this shape, the same
 * rule CLAUDE.md already applies to work-done indices. The approval lives in
 * `runtime_task.result` (jsonb), so there is no migration and the
 * `approval_wait` lease predicate is untouched.
 */
export interface RuntimeApproval {
  id: string;
  requestId: string;
  tool: string;
  message: string;
  status: RuntimeApprovalStatus;
  decision?: 'approve' | 'deny';
  expiresAt: string;
  decidedAt?: string;
  /** Where the owner is being asked. Absent on rows written before this. */
  surface?: 'telegram' | 'web';
  /** Present only for the Telegram surface. */
  telegram?: { connectionId: string; chatId: number; messageId: number };
  /** app_user.id of whoever decided, for the web surface. Telegram's answer
      is attributable through the paired chat instead. */
  decidedBy?: string;
}

export interface FloodDeferResult {
  deferred: boolean;
  shouldNotifyOwner: boolean;
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
  lease_heartbeat_at: Date | null;
  dispatch_phase: RuntimeTaskDispatchPhase;
  cancel_state: RuntimeTaskCancelState;
  remote_run_id: string | null;
  remote_status: string | null;
  result: unknown;
  started_at: Date | null;
  stream_seq: number;
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
  leaseHeartbeatAt: row.lease_heartbeat_at,
  dispatchPhase: row.dispatch_phase,
  cancelState: row.cancel_state,
  remoteRunId: row.remote_run_id,
  remoteStatus: row.remote_status,
  result: row.result,
  startedAt: row.started_at,
  streamSeq: row.stream_seq,
});

const cols = `id, business_id, run_id, kind, status, payload, dedupe_key,
              attempt, lease_token, lease_expires_at, remote_run_id,
              remote_status, result, started_at, lease_heartbeat_at,
              dispatch_phase, cancel_state, stream_seq`;

/** Failure reasons that are infrastructure noise, not product bugs. An
    exhausted lifecycle task (upgrade/provision) whose last error matches this
    is re-armed on the next publish of its dedupe key — the fleet must be able
    to outlast a long registry or sprite-VM outage without a human resetting
    rows. Deliberately conservative: deterministic bootstrap bugs do not match
    and stay exhausted for a human to look at. */
export const TRANSIENT_TASK_ERROR_RE =
  'network|connection lost|econn|etimedout|eai_again|ehost|unreachable|' +
  'socket hang up|fetch failed|registry|5[0-9][0-9]|timeout|dns|refused|reset';

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
  /* Fleet repair callers include a repair-episode id in dedupeKey. Release
     identity alone is insufficient: the same runtime can drift from release X
     again after an earlier X repair completed successfully. */
  const [row] = await tx<TaskRow[]>`
    insert into runtime_task (business_id, run_id, kind, payload, dedupe_key)
    values (${businessId}, ${input.runId ?? null}, ${input.kind},
            ${tx.json((input.payload ?? {}) as never)}, ${input.dedupeKey})
    on conflict (business_id, dedupe_key) do update
      set status = 'queued',
          attempt = 0,
          lease_token = null,
          lease_expires_at = null,
          available_at = now() + interval '60 seconds',
          updated_at = now()
      where runtime_task.status = 'exhausted'
        and runtime_task.kind in ('upgrade', 'provision')
        and runtime_task.last_error ~* ${TRANSIENT_TASK_ERROR_RE}
    returning ${tx.unsafe(cols)}`;
  /* A conflict whose re-arm condition is false (active task, or exhausted with
     a deterministic error) matches no DO UPDATE row, so Postgres returns
     nothing at all — fetch the existing row to keep dedupe semantics:
     republishing always yields the current task. */
  if (row) return task(row);
  const [existing] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where business_id = ${businessId} and dedupe_key = ${input.dedupeKey}`;
  const current = task(existing);
  if (current.status === 'queued' || current.status === 'failed') {
    await queueRuntimeTaskWake(tx, businessId, current.id, new Date());
  }
  return current;
}

/** Ensure a Queue wake has durable backing in the caller's transaction.
    Re-signalling replaces the pending delivery horizon for this task. */
export async function queueRuntimeTaskWake(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  notBefore = new Date(),
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into runtime_task_outbox (business_id, task_id, not_before)
    values (${businessId}, ${taskId}, ${notBefore})
    on conflict (task_id) where sent_at is null do update
      set not_before = excluded.not_before, last_error = null, updated_at = now()
    returning id`;
  return row.id;
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

/** Prefer the task that actually holds the business execution lease. A newer
    queued follow-up must never steal `/stop` from the run already executing. */
export async function activeRuntimeRunTask(
  tx: postgres.TransactionSql,
  businessId: string,
  chatId: number,
): Promise<RuntimeTask | null> {
  const [row] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where business_id = ${businessId}
       and kind in ('run', 'resume')
       and status in ('queued', 'leased', 'failed', 'cancel_requested')
       and payload #>> '{telegram,chatId}' = ${String(chatId)}
     order by (status = 'leased') desc,
              (status = 'cancel_requested') desc,
              created_at desc
     limit 1`;
  return row ? task(row) : null;
}

export type LeaseResult =
  | { outcome: 'leased'; task: RuntimeTask }
  | {
      outcome: 'busy';
      leasedId: string | null;
      selfLeased: boolean;
      leasedLeaseExpiresAt: Date | null;
      leasedLeaseHeartbeatAt: Date | null;
      leasedDispatchPhase: RuntimeTaskDispatchPhase | null;
      leasedRemoteRunId: string | null;
      leasedRemoteStatus: string | null;
      siblingLeaseExpiresAt: Date | null;
    }
  | { outcome: 'done' }
  | { outcome: 'missing' };

export async function leaseRuntimeTask(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  leaseSeconds = RUNTIME_LEASE_SECONDS,
): Promise<LeaseResult> {
  /* Serialize the lease decision on a tenant-scoped advisory key instead of
     the business row. Same mutual exclusion — two concurrent Queue deliveries
     for different tasks of one business can otherwise both pass the pre-checks
     and trip the partial unique index — but advisory locks live in shared
     memory, don't lock the parent row, and skip a business-table round trip.
     Existence is derived from the task row below. */
  /* Keep lock acquisition as its own statement. If it waits for another
     transaction, the next statement must get a fresh READ COMMITTED snapshot
     and see the lease that just won; acquiring inside the UPDATE would retain
     the pre-wait snapshot and could hit the one-lease unique index. */
  await tx`select pg_advisory_xact_lock(hashtextextended(${businessId}::text, 0))`;

  return leaseRuntimeTaskWithBusinessLock(
    tx,
    businessId,
    taskId,
    leaseToken,
    leaseSeconds,
  );
}

/** Lease a task when the caller already holds this business's transaction-
    scoped advisory lock. Queue-first Telegram admission uses this to create
    and lease a fresh task in the same transaction instead of paying for a
    second tenant transaction. Never call this without first acquiring the
    exact hashtextextended(businessId::text, 0) lock. */
export async function leaseRuntimeTaskWithBusinessLock(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  leaseSeconds = RUNTIME_LEASE_SECONDS,
): Promise<LeaseResult> {
  /* Try the common success path directly. UPDATE provides the row lock; the
     business advisory lock already serialises competing lease decisions, so
     a preceding SELECT ... FOR UPDATE was one full Neon round trip with no
     additional safety. */
  const [leased] = await tx<TaskRow[]>`
    update runtime_task
       set status = 'leased', lease_token = ${leaseToken},
           lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
           lease_heartbeat_at = now(),
           dispatch_phase = case when remote_run_id is null
                                 then dispatch_phase else 'remotely_running' end,
           last_error = null, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status in ('queued','failed') and available_at <= now()
       and not exists (
         select 1 from runtime_task sibling
          where sibling.business_id = ${businessId}
            and sibling.status = 'leased'
            and sibling.id <> ${taskId}
       )
       and not exists (
         select 1 from runtime_task approval_wait
          where approval_wait.business_id = ${businessId}
            and approval_wait.id <> ${taskId}
            and approval_wait.kind = 'resume'
            and approval_wait.status in ('queued', 'failed', 'leased')
            and approval_wait.result #>> '{approval,id}' is not null
       )
    returning ${tx.unsafe(cols)}`;
  if (leased) {
    /* This invocation is itself a successful wake delivery. Retire any
       pending outbox row in the same lease transaction; if the owner dies,
       dead-owner recovery creates a fresh wake with the recoverable state. */
    await tx`
      update runtime_task_outbox
         set sent_at = coalesce(sent_at, now()), updated_at = now()
       where task_id = ${taskId} and business_id = ${businessId}
         and sent_at is null`;
    return { outcome: 'leased', task: task(leased) };
  }

  /* The uncommon fallback distinguishes a terminal/missing duplicate from a
     task parked behind the active lease, in one query. */
  const [state] = await tx<{
    status: RuntimeTaskStatus | null;
    current_id: string | null;
    current_lease_expires_at: Date | null;
    current_lease_heartbeat_at: Date | null;
    current_dispatch_phase: RuntimeTaskDispatchPhase | null;
    current_remote_run_id: string | null;
    current_remote_status: string | null;
    sibling_id: string | null;
    sibling_lease_expires_at: Date | null;
    sibling_lease_heartbeat_at: Date | null;
    sibling_dispatch_phase: RuntimeTaskDispatchPhase | null;
    sibling_remote_run_id: string | null;
    sibling_remote_status: string | null;
  }[]>`
    select current.status,
           current.id as current_id,
           current.lease_expires_at as current_lease_expires_at,
           current.lease_heartbeat_at as current_lease_heartbeat_at,
           current.dispatch_phase as current_dispatch_phase,
           current.remote_run_id as current_remote_run_id,
           current.remote_status as current_remote_status,
           sibling.id as sibling_id,
           sibling.lease_expires_at as sibling_lease_expires_at,
           sibling.lease_heartbeat_at as sibling_lease_heartbeat_at,
           sibling.dispatch_phase as sibling_dispatch_phase,
           sibling.remote_run_id as sibling_remote_run_id,
           sibling.remote_status as sibling_remote_status
      from (select 1) gate
      left join runtime_task current
        on current.id = ${taskId} and current.business_id = ${businessId}
      left join lateral (
        select id, lease_expires_at, lease_heartbeat_at, dispatch_phase,
               remote_run_id, remote_status
          from runtime_task
         where business_id = ${businessId} and status = 'leased'
         order by updated_at desc
         limit 1
      ) sibling on true`;
  if (!state?.status) return { outcome: 'missing' };
  if (state.status === 'completed' || state.status === 'cancel_requested' ||
      state.status === 'cancelled' ||
      state.status === 'exhausted') {
    return { outcome: 'done' };
  }
  const selfLeased = state.status === 'leased';
  const leasedLeaseExpiresAt = selfLeased
    ? state.current_lease_expires_at
    : state.sibling_lease_expires_at;
  return {
    outcome: 'busy',
    leasedId: selfLeased ? state.current_id : state.sibling_id,
    selfLeased,
    leasedLeaseExpiresAt,
    leasedLeaseHeartbeatAt: selfLeased
      ? state.current_lease_heartbeat_at
      : state.sibling_lease_heartbeat_at,
    leasedDispatchPhase: selfLeased
      ? state.current_dispatch_phase
      : state.sibling_dispatch_phase,
    leasedRemoteRunId: selfLeased
      ? state.current_remote_run_id
      : state.sibling_remote_run_id,
    leasedRemoteStatus: selfLeased
      ? state.current_remote_status
      : state.sibling_remote_status,
    siblingLeaseExpiresAt: leasedLeaseExpiresAt,
  };
}

/** Release a lease only after its runner has proved the task terminal. The
    remaining-time predicate is the CAS boundary against a concurrent healthy
    renewal; callers may observe a stale lease, probe it, then lose this update
    if ownership was refreshed in the meantime. */
export async function reclaimRuntimeTaskLease(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  reason: string,
  staleRemainingSeconds = RUNTIME_LEASE_STALE_SECONDS,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'failed', lease_token = null, lease_expires_at = null,
           lease_heartbeat_at = null,
           attempt = attempt + 1, available_at = now(),
           last_error = ${reason.slice(0, 1000)}, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased'
       and lease_expires_at <= now() + (${staleRemainingSeconds} * interval '1 second')
    returning id`;
  return rows.length === 1;
}

/** Recover ownership once the prior invocation stopped heartbeating. Unlike
    lease expiry, this detects a dead owner while its original 300-second lease
    is still fresh. Remote work remains addressable by the stable task id, so a
    later slice can idempotently resume observation. */
export async function recoverDeadRuntimeTaskLease(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  reason = 'dead_owner_recovered',
  deadAfterSeconds = 90,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'failed', lease_token = null, lease_expires_at = null,
           lease_heartbeat_at = null, attempt = attempt + 1,
           available_at = now(), last_error = ${reason.slice(0, 1000)},
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased'
       and lease_heartbeat_at <= now() - (${deadAfterSeconds} * interval '1 second')
    returning id`;
  return rows.length === 1;
}

/** Oldest task still waiting for a free slot. This is a database admission
    preference, not a Queue ordering guarantee: duplicate/out-of-order wakeups
    are expected, and the advisory lock plus this ordering decide who runs. */
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
       and not exists (
         select 1 from runtime_task approval_wait
          where approval_wait.business_id = ${businessId}
            and approval_wait.id <> runtime_task.id
            and approval_wait.kind = 'resume'
            and approval_wait.status in ('queued', 'failed', 'leased')
            and approval_wait.result #>> '{approval,id}' is not null
       )
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
           lease_heartbeat_at = null,
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
  detail: {
    remoteRunId?: string;
    remoteStatus?: string;
    delaySeconds?: number;
    result?: unknown;
    /** Last runner event seq this slice relayed; never moves backwards. */
    streamSeq?: number;
  },
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set status = 'queued', lease_token = null, lease_expires_at = null,
           lease_heartbeat_at = null,
           remote_run_id = coalesce(${detail.remoteRunId ?? null}, remote_run_id),
           remote_status = coalesce(${detail.remoteStatus ?? null}, remote_status),
           result = ${detail.result === undefined ? tx`result` : tx.json(detail.result as never)},
           stream_seq = greatest(stream_seq, ${detail.streamSeq ?? 0}::integer),
           started_at = coalesce(started_at, now()),
           available_at = now() + (${detail.delaySeconds ?? 5} * interval '1 second'),
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

/** Turn the currently leased run row into its own durable resume step. The
    approval lives in the task's bounded result metadata, so callback data is
    only an opaque random id and every ownership field is checked server-side. */
export async function pauseRuntimeTaskForApproval(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  input: {
    requestId: string;
    tool: string;
    message: string;
    /** Absent for a web approval: there is no bubble to settle. */
    telegram?: { connectionId: string; chatId: number; messageId: number };
    remoteRunId: string;
    delaySeconds: number;
    /** Last runner event seq relayed before the approval paused the run. */
    streamSeq?: number;
  },
): Promise<RuntimeApproval | null> {
  const [row] = await tx<{ result: unknown }[]>`
    select result from runtime_task
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
     for update`;
  if (!row) return null;
  const approval: RuntimeApproval = {
    id: crypto.randomUUID(),
    requestId: input.requestId,
    tool: input.tool.slice(0, 96),
    message: input.message.slice(0, 1_000),
    status: 'pending',
    expiresAt: new Date(Date.now() + input.delaySeconds * 1_000).toISOString(),
    surface: input.telegram ? 'telegram' : 'web',
    ...(input.telegram ? { telegram: input.telegram } : {}),
  };
  const current = resultObject(row.result);
  const rows = await tx`
    update runtime_task
       set kind = 'resume', status = 'queued', lease_token = null,
           lease_expires_at = null, lease_heartbeat_at = null,
           dispatch_phase = 'remotely_running', remote_run_id = ${input.remoteRunId},
           remote_status = 'waiting_for_approval',
           result = ${tx.json({ ...current, approval } as never)},
           stream_seq = greatest(stream_seq, ${input.streamSeq ?? 0}::integer),
           started_at = coalesce(started_at, now()),
           available_at = now() + (${input.delaySeconds} * interval '1 second'),
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1 ? approval : null;
}

export type RuntimeApprovalClaim =
  | { outcome: 'claimed'; task: RuntimeTask; approval: RuntimeApproval }
  | { outcome: 'duplicate'; task: RuntimeTask; approval: RuntimeApproval }
  | { outcome: 'invalid' };

/**
 * A binding is the proof that this decision came from the surface the
 * approval was actually offered on.
 *
 * For Telegram that is the connection, the paired chat and the bot message —
 * the coordinates the bubble lives at. For the web it is a signed-in user of
 * the same business, which the route has already established; the approval id
 * is opaque and never guessable, and the surface tag stops a Telegram
 * approval being answered by a web POST or the reverse.
 */
export type RuntimeApprovalBinding =
  | { surface: 'telegram'; approvalId: string; connectionId: string; chatId: number; messageId: number }
  | { surface: 'web'; approvalId: string; userId: string };

/** Claim one decision under the same business lock used by leases. It must
    match tenant, surface, binding, opaque approval id, pending state and
    expiry before it can reach the runner. */
export async function claimRuntimeApprovalDecision(
  tx: postgres.TransactionSql,
  businessId: string,
  input: RuntimeApprovalBinding & { decision: 'approve' | 'deny' },
): Promise<RuntimeApprovalClaim> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${businessId}::text, 0))`;
  const [row] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where business_id = ${businessId}
       and result #>> '{approval,id}' = ${input.approvalId}
     for update`;
  if (!row) return { outcome: 'invalid' };
  const currentTask = task(row);
  const approval = runtimeApprovalFromTask(currentTask);
  if (!approval || currentTask.kind !== 'resume' ||
      !['queued', 'failed'].includes(currentTask.status) ||
      /* The surface must match, so a Telegram approval cannot be answered by
         a web POST or the reverse; and a Telegram claim must be about *this*
         bubble. A web approval has no coordinates — the route has already
         established a signed-in owner of this business, and the id is
         opaque. */
      approval.surface !== input.surface ||
      (input.surface === 'telegram' && (
        approval.telegram?.connectionId !== input.connectionId ||
        approval.telegram?.chatId !== input.chatId ||
        approval.telegram?.messageId !== input.messageId))) return { outcome: 'invalid' };
  if ((approval.status === 'approved' || approval.status === 'denied') &&
      approval.decision === input.decision) {
    return { outcome: 'duplicate', task: currentTask, approval };
  }
  /* The edge may have died after claiming (or even after the runner accepted)
     but before committing the final state. Re-entering with the same choice is
     safe because the runner decision route is idempotent by request id. */
  if (approval.status === 'deciding' && approval.decision === input.decision) {
    return { outcome: 'claimed', task: currentTask, approval };
  }
  if (approval.status !== 'pending' || Date.parse(approval.expiresAt) <= Date.now()) {
    return { outcome: 'invalid' };
  }
  const claimed: RuntimeApproval = {
    ...approval,
    status: 'deciding',
    decision: input.decision,
    /* Who answered, for the web surface. Telegram's answer is attributable
       through the paired chat; the web's is only attributable if recorded,
       and "a command ran on the business's machine" is exactly the kind of
       thing that should name a person. */
    ...(input.surface === 'web' ? { decidedBy: input.userId } : {}),
  };
  const result = { ...resultObject(row.result), approval: claimed };
  const rows = await tx`
    update runtime_task
       set result = ${tx.json(result as never)}, updated_at = now()
     where id = ${row.id} and business_id = ${businessId}
       and result #>> '{approval,status}' = 'pending'
    returning id`;
  return rows.length === 1
    ? { outcome: 'claimed', task: { ...currentTask, result }, approval: claimed }
    : { outcome: 'invalid' };
}

export async function completeRuntimeApprovalDecision(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  approvalId: string,
  decision: 'approve' | 'deny',
): Promise<RuntimeApproval | null> {
  const [row] = await tx<{ result: unknown }[]>`
    select result from runtime_task
     where id = ${taskId} and business_id = ${businessId}
       and kind = 'resume' and status in ('queued', 'failed', 'leased')
     for update`;
  if (!row) return null;
  const current = runtimeApprovalFromResult(row.result);
  if (!current || current.id !== approvalId || current.status !== 'deciding' ||
      current.decision !== decision) return null;
  const approval: RuntimeApproval = {
    ...current,
    status: decision === 'approve' ? 'approved' : 'denied',
    decidedAt: new Date().toISOString(),
  };
  const rows = await tx`
    update runtime_task
       set result = ${tx.json({ ...resultObject(row.result), approval } as never)},
           available_at = now(), remote_status = 'running', updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and result #>> '{approval,id}' = ${approvalId}
       and result #>> '{approval,status}' = 'deciding'
    returning id`;
  return rows.length === 1 ? approval : null;
}

export async function releaseRuntimeApprovalDecision(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  approvalId: string,
): Promise<boolean> {
  const [row] = await tx<{ result: unknown }[]>`
    select result from runtime_task
     where id = ${taskId} and business_id = ${businessId}
       and kind = 'resume' and status in ('queued', 'failed')
     for update`;
  const current = runtimeApprovalFromResult(row?.result);
  if (!row || !current || current.id !== approvalId || current.status !== 'deciding') return false;
  const approval: RuntimeApproval = { ...current, status: 'pending' };
  delete approval.decision;
  const rows = await tx`
    update runtime_task
       set result = ${tx.json({ ...resultObject(row.result), approval } as never)},
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and result #>> '{approval,id}' = ${approvalId}
       and result #>> '{approval,status}' = 'deciding'
    returning id`;
  return rows.length === 1;
}

export async function expireRuntimeApproval(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  approvalId: string,
): Promise<RuntimeApproval | null> {
  const [row] = await tx<{ result: unknown }[]>`
    select result from runtime_task
     where id = ${taskId} and business_id = ${businessId}
       and kind = 'resume' and status = 'leased' and lease_token = ${leaseToken}
     for update`;
  const current = runtimeApprovalFromResult(row?.result);
  /* `deciding` is deliberately NOT expirable. It means a surface has already
     claimed this approval and is relaying the owner's answer to the runner.
     Expiring it there wrote a deny over a decision in flight: the runner
     could end up approved while the worker retried a deny into 409s. A click
     that lands on the same second as the deadline should win — the owner did
     answer — and the timeout path should simply find nothing to do. */
  if (!row || !current || current.id !== approvalId || current.status !== 'pending') return null;
  const approval: RuntimeApproval = {
    ...current,
    status: 'expired',
    decision: 'deny',
    decidedAt: new Date().toISOString(),
  };
  const rows = await tx`
    update runtime_task
       set result = ${tx.json({ ...resultObject(row.result), approval } as never)},
           remote_status = 'running', updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
       and result #>> '{approval,id}' = ${approvalId}
    returning id`;
  return rows.length === 1 ? approval : null;
}

/**
 * One approval by its opaque id, for a surface that has only that.
 *
 * The web card is reached by a link and survives a reload, so it cannot rely
 * on holding the task id — and it should not: the approval id is the
 * capability, scoped to the tenant by `withTenant` like everything else.
 * Returns the task too, because every caller needs both.
 */
export async function findRuntimeApproval(
  tx: postgres.TransactionSql,
  businessId: string,
  approvalId: string,
): Promise<{ task: RuntimeTask; approval: RuntimeApproval } | null> {
  const [row] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where business_id = ${businessId}
       and kind = 'resume'
       and result #>> '{approval,id}' = ${approvalId}
     order by created_at desc
     limit 1`;
  if (!row) return null;
  const found = task(row);
  const approval = runtimeApprovalFromTask(found);
  return approval ? { task: found, approval } : null;
}

export function runtimeApprovalFromTask(task: RuntimeTask): RuntimeApproval | null {
  return runtimeApprovalFromResult(task.result);
}

/** Save the bounded terminal answer before any external delivery. Telegram
    may reject that delivery for minutes; a later Queue slice must not depend
    on Hermes retaining its already-completed run record. */
export async function recordRuntimeTaskTerminalOutcome(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  remoteRunId: string,
  outcome: RuntimeTaskTerminalOutcome,
): Promise<boolean> {
  const current = resultObject((await tx<{ result: unknown }[]>`
    select result from runtime_task
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
     for update`)[0]?.result);
  const rows = await tx`
    update runtime_task
       set remote_run_id = ${remoteRunId}, remote_status = ${outcome.remoteStatus},
           result = ${tx.json({ ...current, terminal_outcome: outcome } as never)},
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
    returning id`;
  return rows.length === 1;
}

/** A flood-wait is scheduling state, not a failed attempt. Store Telegram's
    reported wait beside the terminal snapshot while releasing the lease.
    Notification is claimed only after a prior wait doubles or the reported
    wait reaches five minutes. */
export async function deferRuntimeTaskForFlood(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  detail: { floodWaitSeconds: number; delaySeconds: number },
): Promise<FloodDeferResult> {
  const [row] = await tx<{ result: unknown }[]>`
    select result from runtime_task
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
     for update`;
  if (!row) return { deferred: false, shouldNotifyOwner: false };
  const current = resultObject(row.result);
  const previous = positiveInteger(current.flood_wait_seconds);
  const alreadyNotified = current.flood_owner_notified === true;
  const shouldNotifyOwner = !alreadyNotified && (
    detail.floodWaitSeconds >= 300 ||
    (previous !== null && detail.floodWaitSeconds >= previous * 2)
  );
  const deferred = await deferRuntimeTask(tx, businessId, taskId, leaseToken, {
    delaySeconds: detail.delaySeconds,
    result: {
      ...current,
      flood_wait_seconds: detail.floodWaitSeconds,
      flood_owner_notified: alreadyNotified,
    },
  });
  return { deferred, shouldNotifyOwner: deferred && shouldNotifyOwner };
}

/** Mark only after Telegram accepts the notice. If the notice is itself rate
    limited, a later escalated retry may try again instead of recording a lie. */
export async function markRuntimeTaskFloodOwnerNotified(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set result = (case when jsonb_typeof(result) = 'object'
                          then result else '{}'::jsonb end) ||
                    jsonb_build_object('flood_owner_notified', true),
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status in ('queued', 'failed', 'leased')
    returning id`;
  return rows.length === 1;
}

/** Keep ownership while one Worker invocation consumes an ephemeral runtime
    stream. Once the lease enters its stale window it can only be recovered by
    a terminal runner probe followed by reclaimRuntimeTaskLease. */
export async function renewRuntimeTaskLease(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
  leaseSeconds = RUNTIME_LEASE_SECONDS,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
           lease_heartbeat_at = now(),
           updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
       and lease_expires_at > now() + (${RUNTIME_LEASE_STALE_SECONDS} * interval '1 second')
    returning id`;
  return rows.length === 1;
}

/** Durable marker written immediately before remote admission. If the Worker
    dies after this commit, recovery knows the POST may have crossed the wire;
    if it dies before, the row remains `not_dispatched` and can be redispatched
    without treating a runner 404 as ambiguous. */
export async function markRuntimeTaskDispatching(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  leaseToken: string,
): Promise<boolean> {
  const rows = await tx`
    update runtime_task
       set dispatch_phase = 'ambiguously_dispatched', updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'leased' and lease_token = ${leaseToken}
       and remote_run_id is null
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
           dispatch_phase = 'remotely_running',
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
           lease_heartbeat_at = null,
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
           lease_heartbeat_at = null,
           attempt = attempt + 1,
           payload = ${scrubPayload ? tx.json({} as never) : tx`payload`},
           result = ${scrubPayload ? tx.json({} as never) : tx`result`},
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
  confirmation: 'immediate' | 'runner' = 'immediate',
): Promise<{ task: RuntimeTask; changed: boolean } | null> {
  const [current] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where id = ${taskId} and business_id = ${businessId} for update`;
  if (!current) return null;
  if (['completed', 'cancel_requested', 'cancelled', 'exhausted'].includes(current.status)) {
    return { task: task(current), changed: false };
  }
  const needsRunnerConfirmation = confirmation === 'runner' &&
    (current.dispatch_phase !== 'not_dispatched' || current.remote_run_id !== null);
  const [cancelled] = await tx<TaskRow[]>`
    update runtime_task
       set status = ${needsRunnerConfirmation ? 'cancel_requested' : 'cancelled'},
           cancel_state = ${needsRunnerConfirmation ? 'requested' : 'confirmed'},
           lease_token = null, lease_expires_at = null, lease_heartbeat_at = null,
           completed_at = ${needsRunnerConfirmation ? null : tx`now()`}, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
    returning ${tx.unsafe(cols)}`;
  return { task: task(cancelled), changed: true };
}

export async function confirmRuntimeTaskCancellation(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  remoteStatus = 'stopped',
): Promise<RuntimeTask | null> {
  const [row] = await tx<TaskRow[]>`
    update runtime_task
       set status = 'cancelled', cancel_state = 'confirmed', completed_at = now(),
           remote_status = ${remoteStatus.slice(0, 64)}, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'cancel_requested' and cancel_state = 'requested'
    returning ${tx.unsafe(cols)}`;
  if (row) return task(row);
  const [existing] = await tx<TaskRow[]>`
    select ${tx.unsafe(cols)} from runtime_task
     where id = ${taskId} and business_id = ${businessId}
       and status = 'cancelled' and cancel_state = 'confirmed'`;
  return existing ? task(existing) : null;
}

export async function markRuntimeTaskCancelFailed(
  tx: postgres.TransactionSql,
  businessId: string,
  taskId: string,
  reason: string,
): Promise<RuntimeTask | null> {
  const [row] = await tx<TaskRow[]>`
    update runtime_task
       set cancel_state = 'failed', last_error = ${reason.slice(0, 1000)}, updated_at = now()
     where id = ${taskId} and business_id = ${businessId}
       and status = 'cancel_requested' and cancel_state = 'requested'
    returning ${tx.unsafe(cols)}`;
  return row ? task(row) : null;
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

function resultObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function runtimeApprovalFromResult(value: unknown): RuntimeApproval | null {
  const raw = resultObject(value).approval;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const approval = raw as Record<string, unknown>;
  const statuses: RuntimeApprovalStatus[] = [
    'pending', 'deciding', 'approved', 'denied', 'expired',
  ];
  if (typeof approval.id !== 'string' || !uuid(approval.id) ||
      typeof approval.requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(approval.requestId) ||
      typeof approval.tool !== 'string' || !/^[a-zA-Z0-9_.:-]{1,96}$/.test(approval.tool) ||
      typeof approval.message !== 'string' || !approval.message || approval.message.length > 1_000 ||
      typeof approval.status !== 'string' ||
      !statuses.includes(approval.status as RuntimeApprovalStatus) ||
      typeof approval.expiresAt !== 'string' || !Number.isFinite(Date.parse(approval.expiresAt)) ||
      (approval.decision !== undefined &&
        approval.decision !== 'approve' && approval.decision !== 'deny') ||
      (approval.decidedAt !== undefined &&
        (typeof approval.decidedAt !== 'string' || !Number.isFinite(Date.parse(approval.decidedAt))))) {
    return null;
  }
  /* Two shapes in, one out. A row with flat connectionId/chatId/messageId and
     no `surface` predates the web surface and is a Telegram approval; a row
     with `surface` says so itself. Normalising here means every caller sees
     the new shape and none of them has to know that history. */
  const nested = approval.telegram && typeof approval.telegram === 'object'
    ? approval.telegram as Record<string, unknown>
    : approval;
  const connectionId = nested.connectionId;
  const chatId = nested.chatId;
  const messageId = nested.messageId;
  const hasTelegram = typeof connectionId === 'string' && uuid(connectionId) &&
    typeof chatId === 'number' && Number.isSafeInteger(chatId) &&
    typeof messageId === 'number' && Number.isSafeInteger(messageId);
  const surface = approval.surface === 'web' || approval.surface === 'telegram'
    ? approval.surface
    : (hasTelegram ? 'telegram' : null);
  /* A Telegram approval without somewhere to put the bubble is not an
     approval anyone can answer, and neither is a surface we do not know. */
  if (!surface) return null;
  if (surface === 'telegram' && !hasTelegram) return null;
  return {
    id: approval.id as string,
    requestId: approval.requestId as string,
    tool: approval.tool as string,
    message: approval.message as string,
    status: approval.status as RuntimeApprovalStatus,
    ...(approval.decision ? { decision: approval.decision as 'approve' | 'deny' } : {}),
    expiresAt: approval.expiresAt as string,
    ...(approval.decidedAt ? { decidedAt: approval.decidedAt as string } : {}),
    ...(typeof approval.decidedBy === 'string' && uuid(approval.decidedBy)
      ? { decidedBy: approval.decidedBy }
      : {}),
    surface,
    ...(hasTelegram
      ? {
          telegram: {
            connectionId: connectionId as string,
            chatId: chatId as number,
            messageId: messageId as number,
          },
        }
      : {}),
  };
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
