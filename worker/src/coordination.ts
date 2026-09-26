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

export interface RunHandoff {
  id: number;
  specialist: string;
  /** The business's name for this specialist; empty for a key the roster
      does not have, which the app shows as "a specialist", never raw. */
  name: string;
  depth: number;
  outcome: 'working' | 'finished' | 'failed' | 'refused';
  code?: string;
  at: string;
  steps: string[];
}

interface HandoffRow { seq: number; stage: string; specialist: string; depth: number | null; code: string | null; name: string | null; created_at: Date }
interface StepRow { seq: number; agent: string; detail: string }

/* One entry per request, closed by its outcome; a specialist's steps belong
   to its attempt that was open when they happened. */
function handoffsOf(rows: HandoffRow[], steps: StepRow[]): RunHandoff[] {
  const out: (RunHandoff & { openSeq: number; endSeq: number | null })[] = [];
  for (const row of rows) {
    if (row.stage === 'requested') {
      out.push({
        id: row.seq, specialist: row.specialist, name: (row.name ?? '').slice(0, 60),
        depth: row.depth ?? 1, outcome: 'working', at: row.created_at.toISOString(), steps: [],
        openSeq: row.seq, endSeq: null,
      });
      continue;
    }
    const current = [...out].reverse().find((item) => item.specialist === row.specialist && item.endSeq === null);
    if (!current) continue;
    if (row.stage === 'finished' || row.stage === 'failed' || row.stage === 'refused') {
      current.outcome = row.stage;
      if (row.code) current.code = row.code;
      current.endSeq = row.seq;
    }
  }
  for (const step of steps) {
    const owner = [...out].reverse().find((item) => item.specialist === step.agent &&
      item.openSeq < step.seq && (item.endSeq === null || item.endSeq > step.seq));
    if (owner && owner.steps.length < 40) owner.steps.push(step.detail);
  }
  return out.slice(-10).map(({ openSeq: _open, endSeq: _end, ...handoff }) => handoff);
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
  const handoffRows = await tx<HandoffRow[]>`
    select e.seq, e.payload->>'stage' as stage, e.payload->>'specialist' as specialist,
      (e.payload->>'depth')::int as depth, e.payload->>'code' as code, p.name, e.created_at
    from run_event e left join specialist_profile p on p.business_id = e.business_id
      and p.profile_key = e.payload->>'specialist'
    where e.business_id = ${businessId} and e.run_id = ${runId} and e.type = 'agent.handoff'
    order by e.seq asc limit 200`;
  const stepRows = handoffRows.length ? await tx<StepRow[]>`
    select seq, payload->>'agent' as agent, payload->>'detail' as detail from run_event
    where business_id = ${businessId} and run_id = ${runId} and type = 'agent.tool' and payload ? 'agent'
    order by seq asc limit 400` : [];
  const handoffs = handoffsOf(handoffRows, stepRows);
  return {
    assignment: !task ? null : { role: task.profile ? task.name?.slice(0, 100) ?? null : null,
      kind: task.profile ? 'specialist' : 'coordinator' },
    events: rows.reverse().map(row => ({ id: row.seq, stage: row.stage, at: row.created_at })),
    ...(handoffs.length ? { handoffs } : {}),
  };
}
