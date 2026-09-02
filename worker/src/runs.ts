/* ============================================================
   Starting runs, tracing them, and summarising what they did.

   The event sequence is per-run and gap-free, allocated from the rows
   already written rather than from a counter held in memory. Two
   concurrent appends to the same run would otherwise both pick the
   same seq, and the unique constraint turns that into a visible error
   instead of a silently reordered trace.
   ============================================================ */

import type postgres from 'postgres';

export type RunKind = 'ingest' | 'ask' | 'reply' | 'schedule';
export type RunStatus =
  | 'queued'
  | 'working'
  | 'needs_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const RUN_KINDS: readonly RunKind[] = ['ingest', 'ask', 'reply', 'schedule'];

/**
 * The event vocabulary, closed on purpose.
 *
 * Phase 4 groups and compares runs by what happened inside them, which
 * only works if the same thing is always called the same name. A free
 * string would make `action.executed` and `action_executed` two
 * different histories.
 */
export const EVENTS = [
  'work.requested',
  'work.started',
  'fact.retrieved',
  'action.proposed',
  'approval.requested',
  'owner.edited',
  'approval.granted',
  'approval.rejected',
  'action.executed',
  'work.completed',
  'work.failed',
  'outcome.observed',
] as const;
export type RunEventType = (typeof EVENTS)[number];

export interface Run {
  id: string;
  kind: RunKind;
  status: RunStatus;
  triggerShape: string;
  runtime: string;
  model: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

interface RunRow {
  id: string;
  kind: RunKind;
  status: RunStatus;
  trigger_shape: string;
  runtime: string;
  model: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
}

const toRun = (r: RunRow): Run => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  triggerShape: r.trigger_shape,
  runtime: r.runtime,
  model: r.model,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  createdAt: r.created_at,
});

export async function startRun(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    kind: RunKind;
    triggerShape: string;
    triggerRef?: unknown;
    requestedBy?: string | null;
    /* Snapshotted, never looked up again. See the migration. */
    runtime: string;
    model?: string | null;
  },
): Promise<Run> {
  const requested = {
    kind: input.kind,
    triggerShape: input.triggerShape,
  };
  const [row] = await tx<RunRow[]>`
    with started as (
      insert into run (business_id, kind, status, trigger_shape, trigger_ref,
                       requested_by, runtime, model, started_at)
      values (${businessId}, ${input.kind}, 'working', ${input.triggerShape},
              ${input.triggerRef === undefined ? null : tx.json(input.triggerRef as never)},
              ${input.requestedBy ?? null}, ${input.runtime}, ${input.model ?? null}, now())
      returning id, kind, status, trigger_shape, runtime, model,
                started_at, ended_at, created_at
    ), requested as (
      insert into run_event (run_id, business_id, seq, type, payload)
      select id, ${businessId}, 1, 'work.requested', ${tx.json(requested as never)}
        from started
      returning run_id
    )
    select started.* from started join requested on requested.run_id = started.id`;
  return toRun(row);
}

export async function getRun(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
): Promise<Run | null> {
  const [row] = await tx<RunRow[]>`
    select id, kind, status, trigger_shape, runtime, model,
           started_at, ended_at, created_at
      from run where id = ${runId} and business_id = ${businessId}`;
  return row ? toRun(row) : null;
}

/**
 * Append one event to a run's trace.
 *
 * seq comes from the table, not from the caller. A caller tracking it
 * would have to be the only writer for that run, and nothing enforces
 * that — the unique (run_id, seq) constraint does.
 */
export async function append(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
  type: RunEventType,
  payload: unknown = {},
): Promise<number> {
  const [row] = await tx<{ seq: number }[]>`
    insert into run_event (run_id, business_id, seq, type, payload)
    select ${runId}, ${businessId},
           coalesce(max(seq), 0) + 1, ${type}, ${tx.json(payload as never)}
      from run_event where run_id = ${runId}
    returning seq`;
  return row.seq;
}

export async function finishRun(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
  status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled' | 'needs_approval'>,
  detail: unknown = {},
): Promise<void> {
  await tx`
    update run
       set status = ${status},
           ended_at = ${status === 'needs_approval' ? null : tx`now()`}
     where id = ${runId} and business_id = ${businessId}`;

  const type: RunEventType =
    status === 'completed'
      ? 'work.completed'
      : status === 'failed'
        ? 'work.failed'
        : status === 'needs_approval'
          ? 'approval.requested'
          : 'work.failed';
  await append(tx, businessId, runId, type, detail);
}

export async function runTrace(
  tx: postgres.TransactionSql,
  runId: string,
): Promise<{ seq: number; type: string; payload: unknown; createdAt: Date }[]> {
  const rows = await tx<{ seq: number; type: string; payload: unknown; created_at: Date }[]>`
    select seq, type, payload, created_at from run_event
     where run_id = ${runId} order by seq`;
  return rows.map((r) => ({ seq: r.seq, type: r.type, payload: r.payload, createdAt: r.created_at }));
}

/* ---------- work records --------------------------------------------- */

export interface WorkRecordInput {
  runId?: string | null;
  objective: string;
  outcome?: string | null;
  status: string;
  function?: string | null;
  channel?: string | null;
  subject?: string | null;
  risk?: 'low' | 'medium' | 'high' | null;
  /** Links the summary to the approval it is waiting on, so the
      decision can find its way back to the run that raised it. */
  approvalId?: string | null;
  counters?: Record<string, unknown>;
  minutesSaved?: number | null;
  artifacts?: unknown[];
  decision?: string | null;
  inputsUsed?: unknown;
}

export async function recordWork(
  tx: postgres.TransactionSql,
  businessId: string,
  w: WorkRecordInput,
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into work_record
      (business_id, run_id, objective, outcome, status, function, channel,
       subject, risk, approval_id, counters, minutes_saved, artifacts, decision, inputs_used)
    values
      (${businessId}, ${w.runId ?? null}, ${w.objective}, ${w.outcome ?? null},
       ${w.status}, ${w.function ?? null}, ${w.channel ?? null}, ${w.subject ?? null},
       ${w.risk ?? null}, ${w.approvalId ?? null}, ${tx.json((w.counters ?? {}) as never)},
       ${w.minutesSaved ?? null}, ${tx.json((w.artifacts ?? []) as never)},
       ${w.decision ?? null},
       ${w.inputsUsed === undefined ? null : tx.json(w.inputsUsed as never)})
    returning id`;
  return row.id;
}

export type WorkQuality = 'good' | 'poor';

export interface WorkSummary {
  id: string;
  runId: string | null;
  objective: string;
  outcome: string | null;
  status: string;
  function: string | null;
  channel: string | null;
  subject: string | null;
  minutesSaved: number | null;
  /** Owner's verdict on this work, null until they rate it. */
  outcomeQuality: WorkQuality | null;
  qualityAt: Date | null;
  occurredAt: Date;
}

export async function recentWork(
  tx: postgres.TransactionSql,
  limit = 50,
): Promise<WorkSummary[]> {
  const rows = await tx<
    {
      id: string;
      run_id: string | null;
      objective: string;
      outcome: string | null;
      status: string;
      function: string | null;
      channel: string | null;
      subject: string | null;
      minutes_saved: number | null;
      outcome_quality: WorkQuality | 'unknown' | null;
      quality_at: Date | null;
      occurred_at: Date;
    }[]
  >`select id, run_id, objective, outcome, status, function, channel,
           subject, minutes_saved, outcome_quality, quality_at, occurred_at
      from work_record order by occurred_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    objective: r.objective,
    outcome: r.outcome,
    status: r.status,
    function: r.function,
    channel: r.channel,
    subject: r.subject,
    minutesSaved: r.minutes_saved,
    /* The column's check constraint also admits 'unknown' (the default
       position before an owner rates). The app type is good|poor|null,
       so collapse 'unknown' to null rather than leaking a third string
       into WorkSummary. */
    outcomeQuality: r.outcome_quality === 'unknown' ? null : r.outcome_quality,
    qualityAt: r.quality_at,
    occurredAt: r.occurred_at,
  }));
}

/**
 * Record the owner's verdict on a piece of work.
 *
 * Scoped to the tenant so one business can never rate another's record.
 * Returns true when the work_record existed and was updated — the caller
 * turns a miss into a 404 rather than a silent success.
 */
export async function rateWork(
  tx: postgres.TransactionSql,
  businessId: string,
  workId: string,
  quality: WorkQuality,
): Promise<boolean> {
  const result = await tx`
    update work_record
       set outcome_quality = ${quality},
           quality_at = now(),
           updated_at = now()
     where id = ${workId}
       and business_id = ${businessId}`;
  return result.count > 0;
}

/**
 * The numbers Home shows, derived rather than stored.
 *
 * Home used to render hardcoded figures. Counting them here means the
 * dashboard cannot drift away from what actually happened — there is
 * no second copy to drift.
 */
export async function homeCounters(
  tx: postgres.TransactionSql,
): Promise<{
  handled: number;
  needsYou: number;
  minutesSaved: number;
  thisWeek: number;
  connections: number;
}> {
  const [row] = await tx<
    {
      handled: string;
      needs_you: string;
      minutes_saved: string;
      this_week: string;
      connections: string;
    }[]
  >`
    select
      count(*) filter (where status = 'completed')::text                       as handled,
      (select count(*)::text from approval where status = 'pending')           as needs_you,
      -- Real accounts, from the connection table. business.connections
      -- is a playbook-seeded list of what a business of this type
      -- typically uses: it named WhatsApp and Instagram for a business
      -- that had connected neither.
      -- A saved Telegram token is not yet a usable owner channel. Telegram
      -- only becomes connected for readiness after the owner opens the deep
      -- link and presses Start, which writes the internal-chat scope.
      (select count(*)::text
         from connection c
        where c.status = 'connected'
          and (
            c.connector <> 'telegram'
            or exists (
              select 1 from unnest(coalesce(c.scopes, '{}'::text[])) as scope
               where scope like 'telegram-internal-chat:%'
            )
          ))                                                                    as connections,
      coalesce(sum(minutes_saved), 0)::text                                    as minutes_saved,
      count(*) filter (where occurred_at > now() - interval '7 days')::text    as this_week
    from work_record`;
  return {
    handled: Number(row.handled),
    needsYou: Number(row.needs_you),
    minutesSaved: Number(row.minutes_saved),
    thisWeek: Number(row.this_week),
    connections: Number(row.connections),
  };
}

/**
 * Bring an existing summary up to date, or report that there was none.
 *
 * A run that paused for approval already wrote a work record saying so.
 * Inserting a second one when the decision lands would leave the owner
 * reading two rows about one event, one of them permanently claiming to
 * be waiting for them. Updating in place keeps a piece of work to a
 * single line in the history.
 */
export async function updateWorkForRun(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
  patch: { status: string; outcome: string; minutesSaved?: number | null },
): Promise<boolean> {
  const rows = await tx`
    update work_record
       set status = ${patch.status},
           outcome = ${patch.outcome.slice(0, 500)},
           minutes_saved = ${patch.minutesSaved ?? null},
           updated_at = now()
     where business_id = ${businessId} and run_id = ${runId}
    returning id`;
  return rows.length > 0;
}
