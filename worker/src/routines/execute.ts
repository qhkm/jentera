/**
 * Turn an admitted occurrence into a run, a work record and a result, all
 * inside the caller's tenant transaction. V1 jobs are deterministic, so the
 * occurrence completes in the same transaction that admitted it: there is
 * no queued state to observe and nothing to recover. A failure rolls the
 * whole admission back, and the dispatcher retries the slot on its next
 * scan until the missed-window rule retires it.
 */
import type postgres from 'postgres';
import type { Env } from '../env';
import { boundedAgentInput, prepareHermesAgent, retrieveHermesContext } from '../ask';
import { getRuntime } from '../agent-runtime';
import { createRoutineNotification } from '../notifications/store';
import { finishRun, recordWork, startRun } from '../runs';
import { runtimeExecutionEnabled, runtimeReady } from '../runtime/execution';
import { modelForResponseMode } from '../runtime/response-mode';
import { enqueueRuntimeTask, queueRuntimeTaskWake } from '../runtime/tasks';
import { listSpecialists, specialistProfileForRequest } from '../specialists';
import { approvalReminder, summaryReport } from './jobs';
import {
  businessLang,
  finishOccurrence,
  startOccurrence,
  type OccurrenceRow,
  type RoutineRow,
} from './store';

const SUMMARY_CAP = 500;

export interface ExecutionResult {
  occurrence: OccurrenceRow;
  taskId: string | null;
}

export async function executeOccurrence(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
  routine: RoutineRow,
  occurrence: OccurrenceRow,
  /** The owner who pressed run now; null for the scheduler. */
  actor: string | null,
): Promise<ExecutionResult> {
  const startedAt = new Date();
  const lang = await businessLang(tx, businessId);
  const at = occurrence.scheduled_for;

  if (routine.task_kind === 'agent_task') {
    return executeAgentOccurrence(env, tx, businessId, routine, occurrence, actor, lang, startedAt);
  }

  const result = routine.task_kind === 'approval_reminder'
    ? await approvalReminder(tx, at, routine.time_zone, lang)
    : await summaryReport(tx, routine.task_kind, at, routine.time_zone, lang);

  if ('skipped' in result) {
    const finished = await finishOccurrence(tx, businessId, occurrence.id, {
      status: 'skipped',
      runId: null,
      summary: null,
      reason: result.reason,
      startedAt,
    });
    if (occurrence.trigger === 'scheduled') {
      await notify(tx, businessId, routine, finished, lang, 'routine_skipped',
        lang === 'bm' ? 'Tiada tindakan diperlukan untuk rutin ini.' : 'This routine had nothing to report.');
    }
    return { occurrence: finished, taskId: null };
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
  const finished = await finishOccurrence(tx, businessId, occurrence.id, {
    status: 'completed',
    runId: run.id,
    summary: result.text.slice(0, SUMMARY_CAP),
    reason: null,
    startedAt,
  });
  if (occurrence.trigger === 'scheduled') {
    await notify(tx, businessId, routine, finished, lang, 'routine_completed', result.text);
  }
  return { occurrence: finished, taskId: null };
}

async function executeAgentOccurrence(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
  routine: RoutineRow,
  occurrence: OccurrenceRow,
  actor: string | null,
  lang: 'en' | 'bm',
  startedAt: Date,
): Promise<ExecutionResult> {
  const prompt = routine.task_prompt?.trim() ?? '';
  const runtime = await getRuntime(tx, businessId);
  if (!prompt || !runtimeExecutionEnabled(env) || !runtimeReady(runtime) || !env.RUNTIME_QUEUE) {
    const run = await startRun(tx, businessId, {
      kind: 'schedule',
      triggerShape: occurrence.trigger === 'manual' ? 'routine.manual' : 'routine.scheduled',
      triggerRef: { routineId: routine.id, occurrenceId: occurrence.id, revision: occurrence.routine_revision },
      requestedBy: actor,
      runtime: 'hermes-sprite',
      model: env.AISAR_DEEP_MODEL_NAME?.trim() || env.AISAR_MODEL_NAME?.trim() || null,
    });
    const message = lang === 'bm'
      ? 'Jentera tidak dapat memulakan tugasan berjadual ini.'
      : 'Jentera could not start this scheduled task.';
    await recordWork(tx, businessId, {
      runId: run.id,
      objective: routine.name,
      outcome: message,
      status: 'failed',
      function: 'routine',
      channel: 'workspace',
      risk: 'low',
      inputsUsed: { task: routine.task_kind },
    });
    await finishRun(tx, businessId, run.id, 'failed', { reason: 'runtime_unavailable' });
    const finished = await finishOccurrence(tx, businessId, occurrence.id, {
      status: 'failed',
      runId: run.id,
      summary: message,
      reason: 'runtime_unavailable',
      startedAt,
    });
    if (occurrence.trigger === 'scheduled') {
      await notify(tx, businessId, routine, finished, lang, 'routine_failed', message);
    }
    return { occurrence: finished, taskId: null };
  }

  const context = await retrieveHermesContext(tx, prompt);
  const specialists = await listSpecialists(tx, { enabledOnly: true });
  const specialist = specialistProfileForRequest(prompt, specialists);
  const prepared = prepareHermesAgent(prompt, context.facts, context.work, occurrence.scheduled_for, specialist);
  const model = modelForResponseMode(env, 'deep', businessId);
  const run = await startRun(tx, businessId, {
    kind: 'schedule',
    triggerShape: occurrence.trigger === 'manual' ? 'routine.manual' : 'routine.scheduled',
    triggerRef: { routineId: routine.id, occurrenceId: occurrence.id, revision: occurrence.routine_revision },
    requestedBy: actor,
    runtime: 'hermes-sprite',
    model,
  });
  const task = await enqueueRuntimeTask(tx, businessId, {
    kind: 'run',
    runId: run.id,
    dedupeKey: `routine:${occurrence.id}`,
    payload: {
      input: boundedAgentInput(prepared.input),
      instructions: prepared.instructions,
      ...(specialist ? { profile: specialist.profile } : {}),
      sessionId: `routine:${occurrence.id}`,
      objective: routine.name,
      function: 'routine',
      channel: 'workspace',
      factKeys: prepared.usedKeys,
      grounded: prepared.grounded,
      responseMode: 'deep',
      model,
      requestedAtMs: Date.now(),
      routine: {
        id: routine.id,
        occurrenceId: occurrence.id,
        recipientUserId: routine.authorised_by,
        name: routine.name,
        trigger: occurrence.trigger,
        lang,
      },
    },
  });
  await queueRuntimeTaskWake(tx, businessId, task.id);
  const working = await startOccurrence(tx, businessId, occurrence.id, run.id);
  return { occurrence: working, taskId: task.id };
}

async function notify(
  tx: postgres.TransactionSql,
  businessId: string,
  routine: RoutineRow,
  occurrence: OccurrenceRow,
  lang: 'en' | 'bm',
  kind: 'routine_completed' | 'routine_failed' | 'routine_skipped',
  body: string,
): Promise<void> {
  const suffix = kind === 'routine_completed'
    ? lang === 'bm' ? 'selesai' : 'completed'
    : kind === 'routine_failed'
      ? lang === 'bm' ? 'gagal' : 'failed'
      : lang === 'bm' ? 'dilangkau' : 'skipped';
  await createRoutineNotification(tx, businessId, {
    recipientUserId: routine.authorised_by,
    kind,
    title: `${routine.name} — ${suffix}`,
    body,
    sourceKey: `${occurrence.id}:${kind}`,
    runId: occurrence.run_id,
    routineId: routine.id,
    occurrenceId: occurrence.id,
  });
}
