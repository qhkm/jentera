import { isRunId } from '@/lib/task';
import {
  ROUTINE_KINDS, validSchedule,
  type Routine, type RoutineAction, type RoutineList, type RoutineOccurrence,
  type OccurrencePage, type RoutinesApi, type RoutineWriteResult,
} from './types';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Keep error codes and ambiguity: a lost response is not a failed write. */
export class RoutineError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    public readonly uncertain = false,
    public readonly runId?: string,
    public readonly retryAfter?: number,
  ) {
    super(code);
    this.name = 'RoutineError';
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const nullableInstant = (value: unknown) => value === null || instant(value);
const positive = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;

function occurrence(value: unknown): value is RoutineOccurrence {
  if (!object(value)) return false;
  return isRunId(value.id) && isRunId(value.routineId) && positive(value.routineRevision)
    && (value.trigger === 'scheduled' || value.trigger === 'manual') && instant(value.scheduledFor)
    && nullableInstant(value.startedAt) && nullableInstant(value.finishedAt)
    && typeof value.status === 'string' && value.status.length > 0
    && (isRunId(value.runId) || (value.runId === null && value.status === 'skipped'))
    && (value.summary === null || (typeof value.summary === 'string' && value.summary.length <= 500))
    && (value.reason === null || typeof value.reason === 'string');
}

function routine(value: unknown): value is Routine {
  if (!object(value) || !object(value.task) || !object(value.schedule)) return false;
  const kind = value.task.kind;
  return isRunId(value.id) && positive(value.revision)
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 80
    && ROUTINE_KINDS.some((supported) => supported === kind)
    && validSchedule(value.schedule as Routine['schedule']) && value.delivery === 'workspace'
    && typeof value.status === 'string' && value.status.length > 0
    && nullableInstant(value.nextRunAt) && instant(value.createdAt) && instant(value.updatedAt)
    && (value.lastOccurrence === null || (occurrence(value.lastOccurrence) && value.lastOccurrence.routineId === value.id));
}

function list(value: unknown): value is RoutineList {
  if (!object(value) || !object(value.capabilities)) return false;
  const c = value.capabilities;
  return instant(value.serverTime) && typeof c.canManage === 'boolean'
    && typeof c.canSchedule === 'boolean' && typeof c.canRunNow === 'boolean'
    && Array.isArray(c.timeZones) && c.timeZones.every((zone) => typeof zone === 'string')
    && Number.isInteger(c.maxRoutines) && Number(c.maxRoutines) >= 0
    && Array.isArray(value.routines) && value.routines.every(routine);
}

function validateId(id: string) {
  if (!isRunId(id)) throw new RoutineError('ROUTINE_NOT_FOUND', 404);
  return encodeURIComponent(id);
}

async function call(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const writing = body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/routines${path}`, {
      method: writing ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
      ...(writing ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new RoutineError('NETWORK', 0, writing);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || (object(data) && data.ok === false)) {
    const retry = response.headers.get('Retry-After');
    const seconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000)) : NaN;
    throw new RoutineError(
      object(data) && typeof data.code === 'string' ? data.code : 'REQUEST_FAILED', response.status,
      writing && response.status >= 500,
      object(data) && isRunId(data.runId) ? data.runId : undefined,
      Number.isFinite(seconds) ? Math.max(0, seconds) : undefined,
    );
  }
  if (!object(data) || data.apiVersion !== 1 || data.ok !== true) {
    throw new RoutineError('INVALID_RESPONSE', response.status, writing);
  }
  return data;
}

export class RemoteRoutinesApi implements RoutinesApi {
  async list(): Promise<RoutineList> {
    const data = await call('');
    if (!list(data)) throw new RoutineError('INVALID_RESPONSE');
    return data;
  }

  async read(id: string): Promise<Routine> {
    const data = await call(`/${validateId(id)}`);
    if (!routine(data.routine) || data.routine.id !== id) throw new RoutineError('INVALID_RESPONSE');
    return data.routine;
  }

  async occurrences(id: string, cursor?: string): Promise<OccurrencePage> {
    const query = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
    const data = await call(`/${validateId(id)}/occurrences?${query}`);
    if (!Array.isArray(data.occurrences) || !data.occurrences.every((item) => occurrence(item) && item.routineId === id)
      || !(data.nextCursor === null || typeof data.nextCursor === 'string')) throw new RoutineError('INVALID_RESPONSE');
    return data as unknown as OccurrencePage;
  }

  async execute(action: RoutineAction): Promise<RoutineWriteResult> {
    const path = action.kind === 'create' ? '' : `/${validateId(action.id)}/${action.kind}`;
    const data = await call(path, action.body);
    if (action.kind === 'run') {
      if (!occurrence(data.occurrence) || data.occurrence.routineId !== action.id) throw new RoutineError('INVALID_RESPONSE', 200, true);
      return { occurrence: data.occurrence };
    }
    if (!routine(data.routine) || (action.kind !== 'create' && data.routine.id !== action.id)) throw new RoutineError('INVALID_RESPONSE', 200, true);
    return { routine: data.routine };
  }
}
