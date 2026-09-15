import { beforeEach, describe, expect, it } from 'vitest';
import { asApp, asOwner, testEnv, truncateAll } from './harness';
import { connect } from '../src/db';

const BUSINESS_ID = '55555555-5555-4555-8555-555555555555';

interface LivenessRow {
  waiting: string;
  waiting_businesses: string;
  oldest_waiting_secs: number;
  secs_since_completion: number;
}

async function liveness(): Promise<LivenessRow> {
  const sql = connect(testEnv());
  try {
    const [row] = await sql<LivenessRow[]>`select * from public.runtime_liveness()`;
    return row;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${BUSINESS_ID}, 'Kedai', 'restaurant')`;
  });
});

describe('the fleet liveness assertion', () => {
  /* The point of the function: the cron has no tenant, so a plain select as
     aisar_app sees nothing and would report a healthy idle fleet forever. */
  it('counts waiting work that RLS would hide from the caller', async () => {
    await asOwner((sql) => sql`
      insert into runtime_task (business_id, kind, status, payload, dedupe_key, created_at)
      values (${BUSINESS_ID}, 'run', 'queued', '{}'::jsonb, 'liveness-waiting', now() - interval '40 minutes')`);

    const hidden = await asApp((sql) => sql`select count(*)::int as n from runtime_task`);
    expect((hidden[0] as { n: number }).n).toBe(0);

    const live = await liveness();
    expect(Number(live.waiting)).toBe(1);
    expect(Number(live.waiting_businesses)).toBe(1);
    expect(live.oldest_waiting_secs).toBeGreaterThan(2000);
  });

  it('reports no completion when nothing has ever finished', async () => {
    const live = await liveness();
    expect(live.secs_since_completion).toBeGreaterThan(600);
  });

  it('goes quiet once work completes', async () => {
    await asOwner((sql) => sql`
      insert into runtime_task (business_id, kind, status, payload, dedupe_key, completed_at)
      values (${BUSINESS_ID}, 'run', 'completed', '{}'::jsonb, 'liveness-done', now())`);
    const live = await liveness();
    expect(Number(live.waiting)).toBe(0);
    expect(live.secs_since_completion).toBeLessThan(60);
  });
});
