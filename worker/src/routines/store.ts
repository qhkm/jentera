/**
 * Rows and shapes for Routines v1. Every query here runs inside withTenant,
 * so RLS is the boundary; the explicit business_id predicates on writes are
 * belt and braces, as elsewhere in the worker.
 */
import type postgres from 'postgres';
import type { Schedule } from './schedule';
import type { TaskKind } from './jobs';

export interface RoutineRow {
  id: string;
  business_id: string;
  name: string;
  task_kind: TaskKind;
  task_prompt: string | null;
  frequency: Schedule['frequency'];
  weekday: number | null;
  time_of_day: string;
  time_zone: string;
  delivery: 'workspace';
  status: 'active' | 'paused';
  revision: number;
  next_run_at: Date | null;
  created_by: string;
  authorised_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface OccurrenceRow {
  id: string;
  routine_id: string;
  routine_revision: number;
  trigger: 'scheduled' | 'manual';
  scheduled_for: Date;
  started_at: Date | null;
  finished_at: Date | null;
  status: 'queued' | 'working' | 'needs_approval' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  run_id: string | null;
  summary: string | null;
  reason: string | null;
}

export const ROUTINE_COLUMNS = `id, business_id, name, task_kind, task_prompt, frequency, weekday, time_of_day, time_zone,
  delivery, status, revision, next_run_at, created_by, authorised_by, created_at, updated_at`;
const OCCURRENCE_COLUMNS = `id, routine_id, routine_revision, trigger, scheduled_for, started_at, finished_at,
  status, run_id, summary, reason`;

export function scheduleOf(row: RoutineRow): Schedule {
  const schedule: Schedule = { frequency: row.frequency, time: row.time_of_day, timeZone: row.time_zone };
  if (row.frequency === 'weekly' && row.weekday !== null) schedule.weekday = row.weekday;
  return schedule;
}

export interface OccurrenceJson {
  id: string;
  routineId: string;
  routineRevision: number;
  trigger: 'scheduled' | 'manual';
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: OccurrenceRow['status'];
  runId: string | null;
  summary: string | null;
  reason: string | null;
}

export function occurrenceJson(row: OccurrenceRow): OccurrenceJson {
  return {
    id: row.id,
    routineId: row.routine_id,
    routineRevision: row.routine_revision,
    trigger: row.trigger,
    scheduledFor: row.scheduled_for.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    status: row.status,
    runId: row.run_id,
    summary: row.summary,
    reason: row.reason,
  };
}

export interface RoutineJson {
  id: string;
  revision: number;
  name: string;
  task: { kind: TaskKind; prompt?: string };
  schedule: Schedule;
  delivery: 'workspace';
  status: 'active' | 'paused';
  nextRunAt: string | null;
  lastOccurrence: OccurrenceJson | null;
  createdAt: string;
  updatedAt: string;
}

export function routineJson(row: RoutineRow, last: OccurrenceRow | null): RoutineJson {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    task: row.task_kind === 'agent_task'
      ? { kind: row.task_kind, prompt: row.task_prompt ?? '' }
      : { kind: row.task_kind },
    schedule: scheduleOf(row),
    delivery: row.delivery,
    status: row.status,
    nextRunAt: row.next_run_at ? row.next_run_at.toISOString() : null,
    lastOccurrence: last ? occurrenceJson(last) : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listRoutines(tx: postgres.TransactionSql): Promise<RoutineRow[]> {
  return tx.unsafe<RoutineRow[]>(`select ${ROUTINE_COLUMNS} from routine order by created_at, id`);
}

export async function countRoutines(tx: postgres.TransactionSql): Promise<number> {
  const [row] = await tx<{ n: string }[]>`select count(*)::text as n from routine`;
  return Number(row.n);
}

export async function getRoutine(tx: postgres.TransactionSql, id: string): Promise<RoutineRow | null> {
  const [row] = await tx.unsafe<RoutineRow[]>(`select ${ROUTINE_COLUMNS} from routine where id = $1`, [id]);
  return row ?? null;
}

/** The row under a row lock for the rest of the transaction. */
export async function lockRoutine(
  tx: postgres.TransactionSql,
  id: string,
  mode: 'wait' | 'skip' = 'wait',
): Promise<RoutineRow | null> {
  const [row] = await tx.unsafe<RoutineRow[]>(
    `select ${ROUTINE_COLUMNS} from routine where id = $1 for update${mode === 'skip' ? ' skip locked' : ''}`,
    [id],
  );
  return row ?? null;
}

export async function routineByCreateRequest(
  tx: postgres.TransactionSql,
  requestId: string,
): Promise<RoutineRow | null> {
  const [row] = await tx.unsafe<RoutineRow[]>(
    `select ${ROUTINE_COLUMNS} from routine where create_request_id = $1`, [requestId],
  );
  return row ?? null;
}

export async function insertRoutine(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    name: string;
    taskKind: TaskKind;
    taskPrompt: string | null;
    schedule: Schedule;
    status: 'active' | 'paused';
    nextRunAt: Date | null;
    actor: string;
    requestId: string;
  },
): Promise<RoutineRow> {
  const [row] = await tx.unsafe<RoutineRow[]>(
    `insert into routine
       (business_id, name, task_kind, task_prompt, frequency, weekday, time_of_day, time_zone, delivery, status,
        next_run_at, created_by, authorised_by, create_request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'workspace', $9, $10, $11, $11, $12)
     returning ${ROUTINE_COLUMNS}`,
    [businessId, input.name, input.taskKind, input.taskPrompt, input.schedule.frequency,
      input.schedule.weekday ?? null, input.schedule.time, input.schedule.timeZone, input.status,
      input.nextRunAt, input.actor, input.requestId],
  );
  return row;
}

export async function updateRoutineConfig(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  input: { name: string; taskKind: TaskKind; taskPrompt: string | null; schedule: Schedule; nextRunAt: Date | null },
): Promise<RoutineRow> {
  const [row] = await tx.unsafe<RoutineRow[]>(
    `update routine
        set name = $3, task_kind = $4, task_prompt = $5, frequency = $6, weekday = $7,
            time_of_day = $8, time_zone = $9, next_run_at = $10,
            revision = revision + 1, updated_at = now()
      where business_id = $1 and id = $2
      returning ${ROUTINE_COLUMNS}`,
    [businessId, id, input.name, input.taskKind, input.taskPrompt, input.schedule.frequency,
      input.schedule.weekday ?? null, input.schedule.time, input.schedule.timeZone, input.nextRunAt],
  );
  return row;
}

export async function updateRoutineState(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  input: { status: 'active' | 'paused'; nextRunAt: Date | null; authorisedBy?: string; bumpRevision: boolean },
): Promise<RoutineRow> {
  const [row] = await tx.unsafe<RoutineRow[]>(
    `update routine
        set status = $3, next_run_at = $4,
            authorised_by = coalesce($5, authorised_by),
            revision = revision + $6, updated_at = now()
      where business_id = $1 and id = $2
      returning ${ROUTINE_COLUMNS}`,
    [businessId, id, input.status, input.nextRunAt, input.authorisedBy ?? null, input.bumpRevision ? 1 : 0],
  );
  return row;
}

/** Only the dispatcher moves the trigger without touching the revision. */
export async function advanceRoutine(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  nextRunAt: Date,
): Promise<void> {
  await tx`update routine set next_run_at = ${nextRunAt.toISOString()}::timestamptz, updated_at = now()
            where business_id = ${businessId} and id = ${id}`;
}

export async function lastOccurrences(
  tx: postgres.TransactionSql,
  routineIds: string[],
): Promise<Map<string, OccurrenceRow>> {
  const map = new Map<string, OccurrenceRow>();
  if (routineIds.length === 0) return map;
  // The driver runs without type fetching here and sends a JS array as a
  // bare string, so hand Postgres the array literal itself. The ids come
  // from routine rows, never from a request.
  const literal = `{${routineIds.join(',')}}`;
  const rows = await tx.unsafe<OccurrenceRow[]>(
    `select distinct on (routine_id) ${OCCURRENCE_COLUMNS}
       from routine_occurrence
      where routine_id = any($1::uuid[])
      order by routine_id, scheduled_for desc, id desc`,
    [literal],
  );
  for (const row of rows) map.set(row.routine_id, row);
  return map;
}

export async function activeOccurrence(
  tx: postgres.TransactionSql,
  routineId: string,
): Promise<OccurrenceRow | null> {
  const [row] = await tx.unsafe<OccurrenceRow[]>(
    `select ${OCCURRENCE_COLUMNS} from routine_occurrence
      where routine_id = $1 and status in ('queued', 'working', 'needs_approval')
      order by scheduled_for desc limit 1`,
    [routineId],
  );
  return row ?? null;
}

export async function occurrenceByRequest(
  tx: postgres.TransactionSql,
  requestId: string,
): Promise<OccurrenceRow | null> {
  const [row] = await tx.unsafe<OccurrenceRow[]>(
    `select ${OCCURRENCE_COLUMNS} from routine_occurrence where request_id = $1`, [requestId],
  );
  return row ?? null;
}

export async function insertOccurrence(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    routine: RoutineRow;
    trigger: 'scheduled' | 'manual';
    scheduledFor: Date;
    status: 'queued' | 'skipped';
    reason?: string | null;
    requestId?: string | null;
  },
): Promise<OccurrenceRow> {
  const snapshot = {
    task: input.routine.task_kind === 'agent_task'
      ? { kind: input.routine.task_kind, prompt: input.routine.task_prompt }
      : { kind: input.routine.task_kind },
    schedule: scheduleOf(input.routine),
    name: input.routine.name,
    revision: input.routine.revision,
  };
  const [row] = await tx.unsafe<OccurrenceRow[]>(
    `insert into routine_occurrence
       (business_id, routine_id, routine_revision, trigger, scheduled_for, status, reason, request_id, snapshot,
        finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $6 = 'skipped' then now() else null end)
     returning ${OCCURRENCE_COLUMNS}`,
    [businessId, input.routine.id, input.routine.revision, input.trigger, input.scheduledFor, input.status,
      input.reason ?? null, input.requestId ?? null, JSON.stringify(snapshot)],
  );
  return row;
}

export async function finishOccurrence(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  input: {
    status: 'completed' | 'failed' | 'skipped';
    runId: string | null;
    summary: string | null;
    reason: string | null;
    startedAt: Date | null;
  },
): Promise<OccurrenceRow> {
  const [row] = await tx.unsafe<OccurrenceRow[]>(
    `update routine_occurrence
        set status = $3, run_id = $4, summary = $5, reason = $6, started_at = $7, finished_at = now()
      where business_id = $1 and id = $2
      returning ${OCCURRENCE_COLUMNS}`,
    [businessId, id, input.status, input.runId, input.summary, input.reason, input.startedAt],
  );
  return row;
}

export async function startOccurrence(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  runId: string,
): Promise<OccurrenceRow> {
  const [row] = await tx.unsafe<OccurrenceRow[]>(
    `update routine_occurrence
        set status = 'working', run_id = $3, started_at = now()
      where business_id = $1 and id = $2 and status = 'queued'
      returning ${OCCURRENCE_COLUMNS}`,
    [businessId, id, runId],
  );
  return row;
}

export interface OccurrencePage {
  rows: OccurrenceRow[];
  nextCursor: string | null;
}

/** Newest intended trigger first; the cursor is the last row's (scheduled_for, id). */
export async function listOccurrences(
  tx: postgres.TransactionSql,
  routineId: string,
  limit: number,
  cursor: { scheduledFor: Date; id: string } | null,
): Promise<OccurrencePage> {
  const rows = cursor
    ? await tx.unsafe<OccurrenceRow[]>(
      `select ${OCCURRENCE_COLUMNS} from routine_occurrence
        where routine_id = $1 and (scheduled_for, id) < ($2::timestamptz, $3::uuid)
        order by scheduled_for desc, id desc limit $4`,
      [routineId, cursor.scheduledFor, cursor.id, limit + 1],
    )
    : await tx.unsafe<OccurrenceRow[]>(
      `select ${OCCURRENCE_COLUMNS} from routine_occurrence
        where routine_id = $1
        order by scheduled_for desc, id desc limit $2`,
      [routineId, limit + 1],
    );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last
    ? encodeCursor({ scheduledFor: last.scheduled_for, id: last.id })
    : null;
  return { rows: page, nextCursor };
}

export function encodeCursor(cursor: { scheduledFor: Date; id: string }): string {
  return btoa(`${cursor.scheduledFor.toISOString()}|${cursor.id}`);
}

export function decodeCursor(value: string): { scheduledFor: Date; id: string } | null {
  try {
    const [iso, id] = atob(value).split('|');
    const scheduledFor = new Date(iso);
    if (Number.isNaN(scheduledFor.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? '')) return null;
    return { scheduledFor, id };
  } catch {
    return null;
  }
}

export interface ChangeRow {
  routine_id: string;
  operation: 'create' | 'update' | 'state' | 'run';
  request_hash: string;
}

export async function changeByRequest(
  tx: postgres.TransactionSql,
  requestId: string,
): Promise<ChangeRow | null> {
  const [row] = await tx<ChangeRow[]>`
    select routine_id, operation, request_hash from routine_change where request_id = ${requestId}`;
  return row ?? null;
}

export async function recordChange(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    routineId: string;
    requestId: string;
    operation: ChangeRow['operation'];
    requestHash: string;
    revisionBefore: number | null;
    revisionAfter: number;
    actor: string;
  },
): Promise<void> {
  await tx`
    insert into routine_change
      (business_id, routine_id, request_id, operation, request_hash, revision_before, revision_after, actor)
    values (${businessId}, ${input.routineId}, ${input.requestId}, ${input.operation}, ${input.requestHash},
            ${input.revisionBefore}, ${input.revisionAfter}, ${input.actor})`;
}

export async function isOwner(
  tx: postgres.TransactionSql,
  businessId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`
    select exists (select 1 from membership where business_id = ${businessId} and user_id = ${userId} and role = 'owner') as ok`;
  return row.ok;
}

export async function businessLang(tx: postgres.TransactionSql, businessId: string): Promise<'en' | 'bm'> {
  const [row] = await tx<{ lang: string }[]>`select lang from business where id = ${businessId}`;
  return row?.lang === 'bm' ? 'bm' : 'en';
}
