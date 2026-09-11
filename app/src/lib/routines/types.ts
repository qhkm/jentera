/** Routines v1. Preset reports stay deterministic; agent_task is delivered
 * through the same durable Sprite queue as an owner chat request. */
export const ROUTINE_ZONE = 'Asia/Kuala_Lumpur';
export const ROUTINE_KINDS = ['business_summary', 'weekly_summary', 'approval_reminder', 'agent_task'] as const;
export type RoutineKind = typeof ROUTINE_KINDS[number];
export type RoutineSchedule = {
  time: string;
  timeZone: typeof ROUTINE_ZONE;
} & ({ frequency: 'daily' | 'weekdays' } | { frequency: 'weekly'; weekday: number });

export interface RoutineConfig {
  name: string;
  task: { kind: Exclude<RoutineKind, 'agent_task'> } | { kind: 'agent_task'; prompt: string };
  schedule: RoutineSchedule;
  delivery: 'workspace';
}

export interface RoutineOccurrence {
  id: string;
  routineId: string;
  routineRevision: number;
  trigger: 'scheduled' | 'manual';
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Keep unknown future states neutral, never infer completion. */
  status: string;
  runId: string | null;
  summary: string | null;
  reason: string | null;
}

export interface Routine extends RoutineConfig {
  id: string;
  revision: number;
  status: string;
  nextRunAt: string | null;
  lastOccurrence: RoutineOccurrence | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineList {
  ok: true;
  apiVersion: 1;
  serverTime: string;
  capabilities: {
    canManage: boolean;
    canSchedule: boolean;
    canRunNow: boolean;
    timeZones: string[];
    maxRoutines: number;
  };
  routines: Routine[];
}

export interface OccurrencePage {
  ok: true;
  apiVersion: 1;
  occurrences: RoutineOccurrence[];
  nextCursor: string | null;
}

export type RoutineAction =
  | { kind: 'create'; body: RoutineConfig & { requestId: string; enabled: boolean } }
  | { kind: 'update'; id: string; body: RoutineConfig & { requestId: string; expectedRevision: number } }
  | { kind: 'state'; id: string; body: { requestId: string; expectedRevision: number; status: 'active' | 'paused' } }
  | { kind: 'run'; id: string; body: { requestId: string; expectedRevision: number } };

export type RoutineWriteResult = { routine: Routine } | { occurrence: RoutineOccurrence };

export interface RoutinesApi {
  list(): Promise<RoutineList>;
  read(id: string): Promise<Routine>;
  occurrences(id: string, cursor?: string): Promise<OccurrencePage>;
  execute(action: RoutineAction): Promise<RoutineWriteResult>;
}

export function validSchedule(value: RoutineSchedule): boolean {
  return value.timeZone === ROUTINE_ZONE && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
    && (value.frequency === 'weekly'
      ? Number.isInteger(value.weekday) && value.weekday >= 1 && value.weekday <= 7
      : (value.frequency === 'daily' || value.frequency === 'weekdays') && !('weekday' in value));
}

export function knownRoutine(routine: Routine): boolean {
  return routine.status === 'active' || routine.status === 'paused';
}
