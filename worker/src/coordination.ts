import type postgres from 'postgres';
import { append } from './runs';
import type { RunnerToolEvent } from './runtime/runner-client';

/** Tool lifecycle evidence only. Never parse names or reasoning from model prose. */
export async function recordDelegation(tx: postgres.TransactionSql, businessId: string, runId: string,
  taskId: string, event: RunnerToolEvent): Promise<void> {
  if (event.tool !== 'delegate_task' || !Number.isSafeInteger(event.seq)) return;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`coordination:${runId}`}, 0))`;
  const [existing] = await tx`select seq from run_event where business_id = ${businessId} and run_id = ${runId}
    and type = 'agent.delegation' and payload->>'taskId' = ${taskId}
    and payload->>'streamSeq' = ${String(event.seq)}`;
  if (existing) return;
  await append(tx, businessId, runId, 'agent.delegation', {
    taskId, streamSeq: event.seq,
    stage: event.type === 'tool.started' ? 'requested' : event.error ? 'failed' : 'returned',
  });
}

export async function runCoordination(tx: postgres.TransactionSql, businessId: string, runId: string) {
  const [task] = await tx<{ profile: string | null; name: string | null }[]>`
    select t.payload->>'profile' as profile,
      coalesce(t.payload->>'profileName', p.name) as name
    from runtime_task t left join specialist_profile p on p.business_id = t.business_id
      and p.profile_key = t.payload->>'profile'
    where t.business_id = ${businessId} and t.run_id = ${runId} and t.kind = 'run'
    order by t.created_at desc limit 1`;
  const rows = await tx<{ seq: number; stage: string; created_at: Date }[]>`
    select seq, payload->>'stage' as stage, created_at from run_event
    where business_id = ${businessId} and run_id = ${runId} and type = 'agent.delegation'
      and payload->>'stage' in ('requested', 'returned', 'failed')
    order by seq desc limit 50`;
  return {
    assignment: !task ? null : { role: task.profile ? task.name?.slice(0, 100) ?? null : null,
      kind: task.profile ? 'specialist' : 'coordinator' },
    events: rows.reverse().map(row => ({ id: row.seq, stage: row.stage, at: row.created_at })),
  };
}
