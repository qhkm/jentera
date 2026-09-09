/**
 * Turn an admitted occurrence into a run, a work record and a result, all
 * inside the caller's tenant transaction. V1 jobs are deterministic, so the
 * occurrence completes in the same transaction that admitted it: there is
 * no queued state to observe and nothing to recover. A failure rolls the
 * whole admission back, and the dispatcher retries the slot on its next
 * scan until the missed-window rule retires it.
 */
import type postgres from 'postgres';
import { finishRun, recordWork, startRun } from '../runs';
import { approvalReminder, summaryReport } from './jobs';
import { businessLang, finishOccurrence, type OccurrenceRow, type RoutineRow } from './store';

const SUMMARY_CAP = 500;

export async function executeOccurrence(
  tx: postgres.TransactionSql,
  businessId: string,
  routine: RoutineRow,
  occurrence: OccurrenceRow,
  /** The owner who pressed run now; null for the scheduler. */
  actor: string | null,
): Promise<OccurrenceRow> {
  const startedAt = new Date();
  const lang = await businessLang(tx, businessId);
  const at = occurrence.scheduled_for;

  const result = routine.task_kind === 'approval_reminder'
    ? await approvalReminder(tx, at, routine.time_zone, lang)
    : await summaryReport(tx, routine.task_kind, at, routine.time_zone, lang);

  if ('skipped' in result) {
    return finishOccurrence(tx, businessId, occurrence.id, {
      status: 'skipped',
      runId: null,
      summary: null,
      reason: result.reason,
      startedAt,
    });
  }

  const run = await startRun(tx, businessId, {
    kind: 'schedule',
    triggerShape: occurrence.trigger === 'manual' ? 'routine.manual' : 'routine.scheduled',
    triggerRef: { routineId: routine.id, occurrenceId: occurrence.id, revision: occurrence.routine_revision },
    requestedBy: actor,
    runtime: 'deterministic',
    model: null,
  });
  await recordWork(tx, businessId, {
    runId: run.id,
    objective: routine.name,
    outcome: result.text.slice(0, SUMMARY_CAP),
    status: 'completed',
    function: 'routine',
    channel: 'workspace',
    risk: 'low',
    inputsUsed: { task: routine.task_kind, ...result.inputs },
  });
  await finishRun(tx, businessId, run.id, 'completed', {
    routineId: routine.id,
    occurrenceId: occurrence.id,
    task: routine.task_kind,
  });
  return finishOccurrence(tx, businessId, occurrence.id, {
    status: 'completed',
    runId: run.id,
    summary: result.text.slice(0, SUMMARY_CAP),
    reason: null,
    startedAt,
  });
}
