/**
 * Routines v1 HTTP surface (docs/plans/2026-09-09-routines-api-v1.md, as
 * amended). Tenant identity comes from the session, never the body. Every
 * write is idempotent on a client-minted requestId and serialised on the
 * routine row; every response is private and uncached.
 */
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { routinesEnabledFor } from '../routines/gating';
import { TASK_KINDS, type TaskKind } from '../routines/jobs';
import { executeOccurrence } from '../routines/execute';
import { drainRuntimeTaskOutbox } from '../runtime/consumer';
import { nextRunAfter, SUPPORTED_TIME_ZONES, validateSchedule, type Schedule } from '../routines/schedule';
import {
  activeOccurrence,
  changeByRequest,
  countRoutines,
  decodeCursor,
  getRoutine,
  insertOccurrence,
  insertRoutine,
  lastOccurrences,
  listOccurrences,
  listRoutines,
  lockRoutine,
  occurrenceByRequest,
  occurrenceJson,
  recordChange,
  routineByCreateRequest,
  routineJson,
  scheduleOf,
  updateRoutineConfig,
  updateRoutineState,
  type RoutineRow,
} from '../routines/store';

const API_VERSION = 1;
const MAX_ROUTINES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Headers = Record<string, string>;

function json(body: unknown, init: ResponseInit = {}, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      ...headers,
      ...(init.headers ?? {}),
    },
  });
}

function fail(
  status: number,
  code: string,
  err: string,
  cors: Headers,
  fieldErrors?: Record<string, string>,
): Response {
  return json({ ok: false, apiVersion: API_VERSION, code, err, ...(fieldErrors ? { fieldErrors } : {}) },
    { status }, cors);
}

/** sha-256 of the request with its key fields in a stable order, so a
    replay with the same intent hashes the same and a changed one does not. */
async function requestHash(operation: string, body: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify({ operation, body: sortKeys(body) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort()
        .filter((key) => key !== 'requestId')
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

interface RoutineForm {
  name: string;
  taskKind: TaskKind;
  taskPrompt: string | null;
  schedule: Schedule;
}

/** Validate the configuration fields shared by create and update. */
function parseRoutineForm(
  body: Record<string, unknown>,
  allowed: string[],
): { form: RoutineForm } | { response: (cors: Headers) => Response } {
  const fieldErrors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fieldErrors[key] = 'unknown field';
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) fieldErrors.name = 'name must be 1 to 80 characters';
  const task = body.task as Record<string, unknown> | undefined;
  const kind = task && typeof task === 'object' ? task.kind : undefined;
  const prompt = task && typeof task.prompt === 'string' ? task.prompt.trim() : '';
  const allowedTaskKeys = kind === 'agent_task' ? ['kind', 'prompt'] : ['kind'];
  if (!task || typeof task !== 'object' || Array.isArray(task) ||
      Object.keys(task).some((key) => !allowedTaskKeys.includes(key))) {
    fieldErrors.task = kind === 'agent_task' ? 'task must be { kind, prompt }' : 'task must be { kind }';
  }
  if (typeof kind !== 'string' || !TASK_KINDS.includes(kind as TaskKind)) {
    fieldErrors['task.kind'] = `task.kind must be one of ${TASK_KINDS.join(', ')}`;
  }
  if (kind === 'agent_task' && (!prompt || prompt.length > 2000)) {
    fieldErrors['task.prompt'] = 'task.prompt must be 1 to 2000 characters';
  }
  if (kind !== 'agent_task' && task && 'prompt' in task) {
    fieldErrors['task.prompt'] = 'task.prompt is only allowed for agent tasks';
  }
  if (body.delivery !== 'workspace') fieldErrors.delivery = 'delivery must be workspace';
  const validated = validateSchedule(body.schedule);
  let scheduleErrors: Record<string, string> | null = null;
  if ('errors' in validated) {
    scheduleErrors = validated.errors;
    for (const [field, message] of Object.entries(validated.errors)) {
      fieldErrors[`schedule.${field}`] = message;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    const onlySchedule = Object.keys(fieldErrors).every((key) => key.startsWith('schedule.'));
    const code = onlySchedule && scheduleErrors ? 'INVALID_SCHEDULE' : 'INVALID_ROUTINE';
    return { response: (cors) => fail(400, code, 'the routine form is not valid', cors, fieldErrors) };
  }
  return {
    form: {
      name,
      taskKind: kind as TaskKind,
      taskPrompt: kind === 'agent_task' ? prompt : null,
      schedule: (validated as { schedule: Schedule }).schedule,
    },
  };
}

function requestIdOf(body: Record<string, unknown>): string | null {
  return typeof body.requestId === 'string' && UUID.test(body.requestId) ? body.requestId : null;
}

function expectedRevisionOf(body: Record<string, unknown>): number | null {
  const value = body.expectedRevision;
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : null;
}

export async function handleRoutines(
  request: Request,
  env: Env,
  url: URL,
  cors: Headers,
): Promise<Response | null> {
  if (url.pathname !== '/api/routines' && !url.pathname.startsWith('/api/routines/')) return null;

  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }
  const businessId = identity.businessId;
  const actor = identity.userId;
  const owner = identity.role === 'owner';
  const enabled = routinesEnabledFor(env, businessId);
  const capabilities = {
    canManage: owner,
    canSchedule: owner && enabled,
    canRunNow: owner && enabled,
    timeZones: [...SUPPORTED_TIME_ZONES],
    maxRoutines: MAX_ROUTINES,
  };

  /* ---- list ------------------------------------------------------------ */
  if (url.pathname === '/api/routines' && request.method === 'GET') {
    const routines = await withTenant(env, businessId, async (tx) => {
      const rows = await listRoutines(tx);
      const last = await lastOccurrences(tx, rows.map((row) => row.id));
      return rows.map((row) => routineJson(row, last.get(row.id) ?? null));
    });
    return json({
      ok: true,
      apiVersion: API_VERSION,
      serverTime: new Date().toISOString(),
      capabilities,
      routines,
    }, {}, cors);
  }

  /* ---- create ---------------------------------------------------------- */
  if (url.pathname === '/api/routines' && request.method === 'POST') {
    if (!owner) return fail(403, 'OWNER_REQUIRED', 'only an owner can create a routine', cors);
    if (!enabled) return fail(403, 'ROUTINES_DISABLED', 'scheduling is not available for this business', cors);
    const body = await readBody(request);
    if (!body) return fail(400, 'INVALID_ROUTINE', 'request body must be a JSON object', cors);
    const requestId = requestIdOf(body);
    if (!requestId) return fail(400, 'INVALID_REQUEST_ID', 'requestId must be a UUID', cors);
    if (typeof body.enabled !== 'boolean') {
      return fail(400, 'INVALID_ROUTINE', 'the routine form is not valid', cors, { enabled: 'enabled must be true or false' });
    }
    const parsed = parseRoutineForm(body, ['requestId', 'name', 'task', 'schedule', 'delivery', 'enabled']);
    if ('response' in parsed) return parsed.response(cors);
    const { form } = parsed;
    const hash = await requestHash('create', body);

    const outcome = await withTenant(env, businessId, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`routine:create:${businessId}:${requestId}`}, 0))`;
      const existing = await routineByCreateRequest(tx, requestId);
      if (existing) {
        const change = await changeByRequest(tx, requestId);
        if (!change || change.request_hash !== hash) return { conflict: 'IDEMPOTENCY_CONFLICT' as const };
        const last = await lastOccurrences(tx, [existing.id]);
        return { routine: routineJson(existing, last.get(existing.id) ?? null) };
      }
      if ((await countRoutines(tx)) >= MAX_ROUTINES) return { conflict: 'ROUTINE_LIMIT' as const };
      const now = new Date();
      const row = await insertRoutine(tx, businessId, {
        name: form.name,
        taskKind: form.taskKind,
        taskPrompt: form.taskPrompt,
        schedule: form.schedule,
        status: body.enabled ? 'active' : 'paused',
        nextRunAt: body.enabled ? nextRunAfter(form.schedule, now) : null,
        actor,
        requestId,
      });
      await recordChange(tx, businessId, {
        routineId: row.id, requestId, operation: 'create', requestHash: hash,
        revisionBefore: null, revisionAfter: row.revision, actor,
      });
      return { routine: routineJson(row, null) };
    });
    if ('conflict' in outcome) {
      return outcome.conflict === 'ROUTINE_LIMIT'
        ? fail(409, 'ROUTINE_LIMIT', `a business can have at most ${MAX_ROUTINES} routines`, cors)
        : fail(409, 'IDEMPOTENCY_CONFLICT', 'this requestId was already used with a different request', cors);
    }
    return json({ ok: true, apiVersion: API_VERSION, routine: outcome.routine }, { status: 201 }, cors);
  }

  /* ---- one routine ----------------------------------------------------- */
  const match = url.pathname.match(/^\/api\/routines\/([0-9a-f-]{36})(?:\/(update|state|run|occurrences))?$/i);
  if (!match || !UUID.test(match[1])) return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);
  const routineId = match[1];
  const action = match[2] as 'update' | 'state' | 'run' | 'occurrences' | undefined;

  if (!action && request.method === 'GET') {
    const routine = await withTenant(env, businessId, async (tx) => {
      const row = await getRoutine(tx, routineId);
      if (!row) return null;
      const last = await lastOccurrences(tx, [row.id]);
      return routineJson(row, last.get(row.id) ?? null);
    });
    if (!routine) return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);
    return json({ ok: true, apiVersion: API_VERSION, routine }, {}, cors);
  }

  if (action === 'occurrences' && request.method === 'GET') {
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam === null ? 20 : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return fail(400, 'INVALID_ROUTINE', 'limit must be between 1 and 50', cors);
    }
    const cursorParam = url.searchParams.get('cursor');
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) return fail(400, 'INVALID_ROUTINE', 'cursor is not valid', cors);
    const page = await withTenant(env, businessId, async (tx) => {
      const row = await getRoutine(tx, routineId);
      if (!row) return null;
      return listOccurrences(tx, routineId, limit, cursor);
    });
    if (!page) return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);
    return json({
      ok: true,
      apiVersion: API_VERSION,
      occurrences: page.rows.map(occurrenceJson),
      nextCursor: page.nextCursor,
    }, {}, cors);
  }

  if (!action || request.method !== 'POST') return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);

  /* ---- mutations on one routine --------------------------------------- */
  const body = await readBody(request);
  if (!body) return fail(400, 'INVALID_ROUTINE', 'request body must be a JSON object', cors);
  const requestId = requestIdOf(body);
  if (!requestId) return fail(400, 'INVALID_REQUEST_ID', 'requestId must be a UUID', cors);
  const expectedRevision = expectedRevisionOf(body);
  if (expectedRevision === null) {
    return fail(400, 'INVALID_ROUTINE', 'expectedRevision must be a positive integer', cors);
  }

  // The tenant check comes before the permission check so a member and a
  // stranger get different answers only when the routine exists for them.
  const exists = await withTenant(env, businessId, (tx) => getRoutine(tx, routineId));
  if (!exists) return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);
  if (!owner) return fail(403, 'OWNER_REQUIRED', 'only an owner can change a routine', cors);

  if (action === 'update') {
    if (!enabled) return fail(403, 'ROUTINES_DISABLED', 'scheduling is not available for this business', cors);
    const parsed = parseRoutineForm(body, ['requestId', 'expectedRevision', 'name', 'task', 'schedule', 'delivery']);
    if ('response' in parsed) return parsed.response(cors);
    const hash = await requestHash('update', body);
    const outcome = await mutate(env, businessId, routineId, requestId, hash, 'update', expectedRevision,
      async (tx, row) => {
        const now = new Date();
        return updateRoutineConfig(tx, businessId, row.id, {
          name: parsed.form.name,
          taskKind: parsed.form.taskKind,
          taskPrompt: parsed.form.taskPrompt,
          schedule: parsed.form.schedule,
          nextRunAt: row.status === 'active' ? nextRunAfter(parsed.form.schedule, now) : null,
        });
      }, actor);
    return respond(outcome, cors, 200);
  }

  if (action === 'state') {
    const status = body.status;
    if (status !== 'active' && status !== 'paused') {
      return fail(400, 'INVALID_ROUTINE', 'status must be active or paused', cors);
    }
    for (const key of Object.keys(body)) {
      if (!['requestId', 'expectedRevision', 'status'].includes(key)) {
        return fail(400, 'INVALID_ROUTINE', 'the request has unknown fields', cors, { [key]: 'unknown field' });
      }
    }
    if (status === 'active' && !enabled) {
      return fail(403, 'ROUTINES_DISABLED', 'scheduling is not available for this business', cors);
    }
    const hash = await requestHash('state', body);
    const outcome = await mutate(env, businessId, routineId, requestId, hash, 'state', expectedRevision,
      async (tx, row) => updateRoutineState(tx, businessId, row.id, {
        status,
        nextRunAt: status === 'active' ? nextRunAfter(scheduleOf(row), new Date()) : null,
        authorisedBy: status === 'active' ? actor : undefined,
        bumpRevision: true,
      }), actor);
    return respond(outcome, cors, 200);
  }

  if (action === 'run') {
    if (!enabled) return fail(403, 'ROUTINES_DISABLED', 'scheduling is not available for this business', cors);
    for (const key of Object.keys(body)) {
      if (!['requestId', 'expectedRevision'].includes(key)) {
        return fail(400, 'INVALID_ROUTINE', 'the request has unknown fields', cors, { [key]: 'unknown field' });
      }
    }
    const hash = await requestHash('run', body);
    const outcome = await withTenant(env, businessId, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`routine:run:${businessId}:${requestId}`}, 0))`;
      const replay = await occurrenceByRequest(tx, requestId);
      if (replay) {
        const change = await changeByRequest(tx, requestId);
        if (!change || change.request_hash !== hash || change.routine_id !== routineId) {
          return { conflict: 'IDEMPOTENCY_CONFLICT' as const };
        }
        return { occurrence: occurrenceJson(replay) };
      }
      const row = await lockRoutine(tx, routineId);
      if (!row) return { conflict: 'ROUTINE_NOT_FOUND' as const };
      if (row.revision !== expectedRevision) return { conflict: 'REVISION_CONFLICT' as const };
      const active = await activeOccurrence(tx, row.id);
      if (active) return { conflict: 'RUN_ALREADY_ACTIVE' as const, runId: active.run_id };
      const occurrence = await insertOccurrence(tx, businessId, {
        routine: row, trigger: 'manual', scheduledFor: new Date(), status: 'queued', requestId,
      });
      await recordChange(tx, businessId, {
        routineId: row.id, requestId, operation: 'run', requestHash: hash,
        revisionBefore: row.revision, revisionAfter: row.revision, actor,
      });
      const execution = await executeOccurrence(env, tx, businessId, row, occurrence, actor);
      return { occurrence: occurrenceJson(execution.occurrence), taskId: execution.taskId };
    });
    if ('conflict' in outcome) {
      switch (outcome.conflict) {
        case 'ROUTINE_NOT_FOUND': return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);
        case 'REVISION_CONFLICT': return fail(409, 'REVISION_CONFLICT', 'the routine changed; reload it', cors);
        case 'RUN_ALREADY_ACTIVE':
          return json({
            ok: false, apiVersion: API_VERSION, code: 'RUN_ALREADY_ACTIVE',
            err: 'this routine is already running', runId: outcome.runId ?? null,
          }, { status: 409 }, cors);
        default: return fail(409, 'IDEMPOTENCY_CONFLICT', 'this requestId was already used with a different request', cors);
      }
    }
    if (outcome.taskId) {
      await drainRuntimeTaskOutbox(env, { taskId: outcome.taskId }).catch((error) => {
        console.error(`[routines] runtime wake failed task=${outcome.taskId} ${String(error)}`);
      });
    }
    return json({ ok: true, apiVersion: API_VERSION, occurrence: outcome.occurrence }, { status: 202 }, cors);
  }

  return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);
}

type MutationOutcome =
  | { routine: ReturnType<typeof routineJson> }
  | { conflict: 'ROUTINE_NOT_FOUND' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' };

/** Replay check first, then the revision check, then the write, all under
    the routine's row lock so a pause and a dispatch cannot interleave. */
async function mutate(
  env: Env,
  businessId: string,
  routineId: string,
  requestId: string,
  hash: string,
  operation: 'update' | 'state',
  expectedRevision: number,
  write: (tx: Parameters<Parameters<typeof withTenant>[2]>[0], row: RoutineRow) => Promise<RoutineRow>,
  actor: string,
): Promise<MutationOutcome> {
  return withTenant(env, businessId, async (tx) => {
    const row = await lockRoutine(tx, routineId);
    if (!row) return { conflict: 'ROUTINE_NOT_FOUND' as const };
    const replay = await changeByRequest(tx, requestId);
    if (replay) {
      if (replay.request_hash !== hash || replay.routine_id !== routineId) {
        return { conflict: 'IDEMPOTENCY_CONFLICT' as const };
      }
      const last = await lastOccurrences(tx, [row.id]);
      return { routine: routineJson(row, last.get(row.id) ?? null) };
    }
    if (row.revision !== expectedRevision) return { conflict: 'REVISION_CONFLICT' as const };
    const updated = await write(tx, row);
    await recordChange(tx, businessId, {
      routineId: row.id, requestId, operation, requestHash: hash,
      revisionBefore: row.revision, revisionAfter: updated.revision, actor,
    });
    const last = await lastOccurrences(tx, [row.id]);
    return { routine: routineJson(updated, last.get(row.id) ?? null) };
  });
}

function respond(outcome: MutationOutcome, cors: Headers, status: number): Response {
  if ('conflict' in outcome) {
    switch (outcome.conflict) {
      case 'ROUTINE_NOT_FOUND': return fail(404, 'ROUTINE_NOT_FOUND', 'routine not found', cors);
      case 'REVISION_CONFLICT': return fail(409, 'REVISION_CONFLICT', 'the routine changed; reload it', cors);
      default: return fail(409, 'IDEMPOTENCY_CONFLICT', 'this requestId was already used with a different request', cors);
    }
  }
  return json({ ok: true, apiVersion: API_VERSION, routine: outcome.routine }, { status }, cors);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) return null;
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
