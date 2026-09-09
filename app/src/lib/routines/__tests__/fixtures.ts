import type { OccurrencePage, Routine, RoutineList, RoutineOccurrence } from '../types';

export const ROUTINE_ID = '11111111-1111-4111-8111-111111111111';
export const RUN_ID = '44444444-4444-4444-8444-444444444444';
export const NOW = '2026-09-09T03:30:00.000Z';
export function occurrenceFixture(patch: Partial<RoutineOccurrence> = {}): RoutineOccurrence {
  return {
    id: '33333333-3333-4333-8333-333333333333', routineId: ROUTINE_ID, routineRevision: 1,
    trigger: 'scheduled', scheduledFor: NOW, startedAt: NOW, finishedAt: NOW,
    status: 'completed', runId: RUN_ID, summary: '6 work records in the past 24 hours.', reason: null, ...patch,
  };
}
export function routineFixture(patch: Partial<Routine> = {}): Routine {
  return {
    id: ROUTINE_ID, revision: 1, name: 'Morning business summary', task: { kind: 'business_summary' },
    schedule: { frequency: 'weekdays', time: '08:00', timeZone: 'Asia/Kuala_Lumpur' },
    delivery: 'workspace', status: 'active', nextRunAt: '2026-09-10T00:00:00.000Z',
    lastOccurrence: null, createdAt: NOW, updatedAt: NOW, ...patch,
  };
}
export function listFixture(routines: Routine[] = []): RoutineList {
  return { ok: true, apiVersion: 1, serverTime: NOW,
    capabilities: { canManage: true, canSchedule: true, canRunNow: true, timeZones: ['Asia/Kuala_Lumpur'], maxRoutines: 10 }, routines };
}
export function historyFixture(occurrences: RoutineOccurrence[] = []): OccurrencePage {
  return { ok: true, apiVersion: 1, occurrences, nextCursor: null };
}
