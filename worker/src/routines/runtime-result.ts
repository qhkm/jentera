import type postgres from 'postgres';
import { createRoutineNotification } from '../notifications/store';

interface RoutineRuntimeMeta {
  id: string;
  occurrenceId: string;
  recipientUserId: string;
  name: string;
  trigger: 'scheduled' | 'manual';
  lang: 'en' | 'bm';
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

export function routineRuntimeMeta(payload: unknown): RoutineRuntimeMeta | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>).routine;
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!uuid(row.id) || !uuid(row.occurrenceId) || !uuid(row.recipientUserId) ||
      typeof row.name !== 'string' || !row.name || row.name.length > 80 ||
      (row.trigger !== 'scheduled' && row.trigger !== 'manual')) return null;
  return {
    id: row.id,
    occurrenceId: row.occurrenceId,
    recipientUserId: row.recipientUserId,
    name: row.name,
    trigger: row.trigger,
    lang: row.lang === 'bm' ? 'bm' : 'en',
  };
}

export async function markRoutineNeedsApproval(
  tx: postgres.TransactionSql,
  businessId: string,
  payload: unknown,
  runId: string | null,
  message: string,
): Promise<void> {
  const meta = routineRuntimeMeta(payload);
  if (!meta || !runId) return;
  await tx`
    update routine_occurrence
       set status = 'needs_approval', run_id = ${runId}
     where business_id = ${businessId} and id = ${meta.occurrenceId}
       and routine_id = ${meta.id} and status in ('queued','working','needs_approval')`;
  if (meta.trigger !== 'scheduled') return;
  await createRoutineNotification(tx, businessId, {
    recipientUserId: meta.recipientUserId,
    kind: 'routine_needs_approval',
    title: meta.lang === 'bm'
      ? `${meta.name} — perlukan kelulusan`
      : `${meta.name} — needs approval`,
    body: message || (meta.lang === 'bm'
      ? 'Tugasan berjadual ini sedang menunggu keputusan anda.'
      : 'This scheduled task is waiting for your decision.'),
    sourceKey: `${meta.occurrenceId}:routine_needs_approval`,
    runId,
    routineId: meta.id,
    occurrenceId: meta.occurrenceId,
  });
}

export async function finishRoutineRuntimeOccurrence(
  tx: postgres.TransactionSql,
  businessId: string,
  payload: unknown,
  runId: string | null,
  input: { successful: boolean; summary: string; budgetExceeded?: boolean },
): Promise<void> {
  const meta = routineRuntimeMeta(payload);
  if (!meta || !runId) return;
  const status = input.successful ? 'completed' : 'failed';
  const reason = input.successful ? null : input.budgetExceeded ? 'budget_exceeded' : 'runtime_unavailable';
  await tx`
    update routine_occurrence
       set status = ${status}, run_id = ${runId}, summary = ${input.summary.slice(0, 500)},
           reason = ${reason}, finished_at = now(), started_at = coalesce(started_at, now())
     where business_id = ${businessId} and id = ${meta.occurrenceId}
       and routine_id = ${meta.id} and status in ('queued','working','needs_approval')`;
  if (meta.trigger !== 'scheduled') return;
  const kind = input.successful ? 'routine_completed' : 'routine_failed';
  await createRoutineNotification(tx, businessId, {
    recipientUserId: meta.recipientUserId,
    kind,
    title: input.successful
      ? `${meta.name} — ${meta.lang === 'bm' ? 'selesai' : 'completed'}`
      : `${meta.name} — ${meta.lang === 'bm' ? 'gagal' : 'failed'}`,
    body: input.summary || (meta.lang === 'bm'
      ? 'Jentera tidak dapat menyelesaikan tugasan berjadual ini.'
      : 'Jentera could not complete this scheduled task.'),
    sourceKey: `${meta.occurrenceId}:${kind}`,
    runId,
    routineId: meta.id,
    occurrenceId: meta.occurrenceId,
  });
}

export async function cancelRoutineRuntimeOccurrence(
  tx: postgres.TransactionSql,
  businessId: string,
  payload: unknown,
  runId: string | null,
): Promise<void> {
  const meta = routineRuntimeMeta(payload);
  if (!meta || !runId) return;
  const body = meta.lang === 'bm'
    ? 'Tugasan berjadual ini telah dibatalkan.'
    : 'This scheduled task was cancelled.';
  await tx`
    update routine_occurrence
       set status = 'cancelled', run_id = ${runId}, summary = ${body}, reason = null,
           finished_at = now(), started_at = coalesce(started_at, now())
     where business_id = ${businessId} and id = ${meta.occurrenceId}
       and routine_id = ${meta.id} and status in ('queued','working','needs_approval')`;
  if (meta.trigger !== 'scheduled') return;
  await createRoutineNotification(tx, businessId, {
    recipientUserId: meta.recipientUserId,
    kind: 'routine_failed',
    title: `${meta.name} — ${meta.lang === 'bm' ? 'dibatalkan' : 'cancelled'}`,
    body,
    sourceKey: `${meta.occurrenceId}:routine_cancelled`,
    runId,
    routineId: meta.id,
    occurrenceId: meta.occurrenceId,
  });
}
