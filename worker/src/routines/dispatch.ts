/**
 * The one-minute dispatcher. Postgres is the scheduler: a routine's
 * next_run_at is the only clock, and the claim is a row lock inside the
 * tenant's own transaction. The cross-tenant part is a SECURITY DEFINER
 * function that returns nothing but (business, routine, slot).
 *
 * Rules, from the contract: one due occurrence per routine per scan; a slot
 * more than ten minutes late is skipped, not run; a routine whose
 * authorising owner is no longer an owner is paused; an occurrence still
 * active blocks the next one. Skipped occurrences occupy their slot, so the
 * unique (business, routine, scheduled_for) index makes overlap, redelivery
 * and restarts converge on one row.
 */
import { connect, withTenant } from '../db';
import type { Env } from '../env';
import { routinesEnabledFor } from './gating';
import { executeOccurrence } from './execute';
import { drainRuntimeTaskOutbox } from '../runtime/consumer';
import { nextRunAfter } from './schedule';
import {
  activeOccurrence,
  advanceRoutine,
  insertOccurrence,
  isOwner,
  lockRoutine,
  scheduleOf,
  updateRoutineState,
} from './store';

export const MISSED_WINDOW_MS = 10 * 60_000;
const SCAN_LIMIT = 50;

export interface DispatchSummary {
  admitted: number;
  skipped: number;
  errors: number;
}

interface DueTarget {
  business_id: string;
  routine_id: string;
  next_run_at: Date;
}

export async function dispatchDueRoutines(env: Env, now = new Date()): Promise<DispatchSummary> {
  const summary: DispatchSummary = { admitted: 0, skipped: 0, errors: 0 };
  const sql = connect(env);
  let targets: DueTarget[];
  try {
    targets = await sql<DueTarget[]>`
      select business_id, routine_id, next_run_at
        from public.routine_due_targets(${now.toISOString()}::timestamptz, ${SCAN_LIMIT})`;
  } finally {
    await sql.end();
  }

  for (const target of targets) {
    if (!routinesEnabledFor(env, target.business_id)) continue;
    try {
      const result = await withTenant(env, target.business_id, (tx) => admit(env, tx, target, now));
      if (result.outcome === 'admitted') summary.admitted += 1;
      else if (result.outcome === 'skipped') summary.skipped += 1;
      if (result.taskId) {
        await drainRuntimeTaskOutbox(env, { taskId: result.taskId }).catch((error) => {
          console.error(`[routines] runtime wake failed task=${result.taskId} ${String(error)}`);
        });
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`[routines] business=${target.business_id} routine=${target.routine_id} ${String(err)}`);
    }
  }
  return summary;
}

type Outcome = { outcome: 'admitted' | 'skipped' | 'none'; taskId: string | null };

async function admit(
  env: Env,
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  target: DueTarget,
  now: Date,
): Promise<Outcome> {
  const routine = await lockRoutine(tx, target.routine_id, 'skip');
  // Another dispatcher holds it, or it moved on since the scan.
  if (!routine || routine.status !== 'active' || !routine.next_run_at) return { outcome: 'none', taskId: null };
  if (routine.next_run_at.getTime() !== target.next_run_at.getTime()) return { outcome: 'none', taskId: null };
  if (routine.next_run_at.getTime() > now.getTime()) return { outcome: 'none', taskId: null };
  const businessId = routine.business_id;
  const slot = routine.next_run_at;
  const schedule = scheduleOf(routine);

  if (!(await isOwner(tx, businessId, routine.authorised_by))) {
    await insertOccurrence(tx, businessId, {
      routine, trigger: 'scheduled', scheduledFor: slot, status: 'skipped', reason: 'permission_revoked',
    });
    await updateRoutineState(tx, businessId, routine.id, {
      status: 'paused', nextRunAt: null, bumpRevision: false,
    });
    return { outcome: 'skipped', taskId: null };
  }

  if (now.getTime() - slot.getTime() > MISSED_WINDOW_MS) {
    await insertOccurrence(tx, businessId, {
      routine, trigger: 'scheduled', scheduledFor: slot, status: 'skipped', reason: 'missed_window',
    });
    await advanceRoutine(tx, businessId, routine.id, nextRunAfter(schedule, now));
    return { outcome: 'skipped', taskId: null };
  }

  if (await activeOccurrence(tx, routine.id)) {
    await insertOccurrence(tx, businessId, {
      routine, trigger: 'scheduled', scheduledFor: slot, status: 'skipped', reason: 'previous_run_active',
    });
    await advanceRoutine(tx, businessId, routine.id, nextRunAfter(schedule, slot));
    return { outcome: 'skipped', taskId: null };
  }

  const occurrence = await insertOccurrence(tx, businessId, {
    routine, trigger: 'scheduled', scheduledFor: slot, status: 'queued',
  });
  await advanceRoutine(tx, businessId, routine.id, nextRunAfter(schedule, slot));
  const execution = await executeOccurrence(env, tx, businessId, routine, occurrence, null);
  return { outcome: 'admitted', taskId: execution.taskId };
}
