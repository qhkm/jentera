import { beforeEach, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { asOwner, testEnv, truncateAll } from './harness';
import { sweepRuntimeLiveness } from '../src/runtime/liveness';

/* One probe in a cron that already runs. It records what it sees and acts on
   nothing: thresholds come from a week of real outcomes, because the one
   number in hand — five of seven prewarms failing at exactly the old 8000 ms
   budget — says a probe calibrated by intuition would call a healthy fleet
   dead. docs/plans/2026-09-23-runtime-liveness.md. */

beforeEach(async () => { await truncateAll(); });

async function seed(sql: postgres.Sql, url: string | null = 'https://s.sprites.app') {
  const businessId = crypto.randomUUID();
  await sql`insert into business (id, name, playbook_key) values (${businessId}, 'Probe Co', 'generic')`;
  const [row] = await sql<{ id: string }[]>`
    insert into agent_runtime (business_id, provider, provider_name, provider_url, status,
      desired_release, observed_release)
    values (${businessId}, 'fly-sprite', ${'aisar-b-' + businessId.replace(/-/g, '').slice(0, 20)}, ${url}, 'ready',
      '2026.09.23-2', '2026.09.23-2')
    returning id`;
  return row.id;
}

const ok = () => new Response('{}', { status: 200 });

it('records a reachable sprite without touching status', async () => {
  const env = testEnv({ SPRITES_TOKEN: 'probe-token' });
  const id = await asOwner(sql => seed(sql));
  vi.stubGlobal('fetch', vi.fn(ok));

  const swept = await sweepRuntimeLiveness(env);
  expect(swept).toBe(1);

  await asOwner(async sql => {
    const [row] = await sql<{ last_check_outcome: string; status: string; unhealthy_since: Date | null }[]>`
      select last_check_outcome, status, unhealthy_since from agent_runtime where id = ${id}`;
    expect(row.last_check_outcome).toBe('reachable');
    // The whole point: a new opinion recorded beside the old one, not over it.
    expect(row.status).toBe('ready');
    expect(row.unhealthy_since).toBeNull();
  });
  vi.unstubAllGlobals();
});

it('records an unreachable sprite and starts the clock on the outage', async () => {
  const env = testEnv({ SPRITES_TOKEN: 'probe-token' });
  const id = await asOwner(sql => seed(sql));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));

  await sweepRuntimeLiveness(env);
  await asOwner(async sql => {
    const [row] = await sql<{ last_check_outcome: string; unhealthy_since: Date | null; status: string }[]>`
      select last_check_outcome, unhealthy_since, status from agent_runtime where id = ${id}`;
    expect(row.last_check_outcome).toBe('unreachable');
    expect(row.unhealthy_since).not.toBeNull();
    // Still not demoting anything. Nothing acts on this yet, deliberately.
    expect(row.status).toBe('ready');
  });
  vi.unstubAllGlobals();
});

it('a refusal is not the same as silence', async () => {
  const env = testEnv({ SPRITES_TOKEN: 'probe-token' });
  const id = await asOwner(sql => seed(sql));
  // A sprite that answers 503 is reachable; the host is up and talking.
  // Calling that unreachable would make the signal mean two things.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 503 })));

  await sweepRuntimeLiveness(env);
  await asOwner(async sql => {
    const [row] = await sql<{ last_check_outcome: string }[]>`
      select last_check_outcome from agent_runtime where id = ${id}`;
    expect(row.last_check_outcome).toBe('reachable');
  });
  vi.unstubAllGlobals();
});

it('one sprite failing does not stop the sweep reaching the rest', async () => {
  const env = testEnv({ SPRITES_TOKEN: 'probe-token' });
  await asOwner(async sql => { await seed(sql); await seed(sql); await seed(sql); });
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    call += 1;
    if (call === 1) throw new Error('connection reset');
    return ok();
  }));

  const swept = await sweepRuntimeLiveness(env);
  expect(swept).toBe(3);
  await asOwner(async sql => {
    /* Every row in the truncated schema is one of the three. Binding an array
       here would hit the bare-comma-list trap that arrayParameter exists for. */
    const rows = await sql<{ last_check_outcome: string }[]>`
      select last_check_outcome from agent_runtime`;
    expect(rows.filter(r => r.last_check_outcome === 'reachable').length).toBe(2);
    expect(rows.filter(r => r.last_check_outcome === 'unreachable').length).toBe(1);
  });
  vi.unstubAllGlobals();
});

it('skips a runtime it cannot probe rather than calling it dead', async () => {
  const env = testEnv({ SPRITES_TOKEN: 'probe-token' });
  // No provider URL: there is nothing to ask. Recording "unreachable" here
  // would manufacture an outage out of a missing field.
  const id = await asOwner(sql => seed(sql, null));
  const fetchFake = vi.fn(ok);
  vi.stubGlobal('fetch', fetchFake);

  await sweepRuntimeLiveness(env);
  expect(fetchFake).not.toHaveBeenCalled();
  await asOwner(async sql => {
    const [row] = await sql<{ last_check_outcome: string | null }[]>`
      select last_check_outcome from agent_runtime where id = ${id}`;
    expect(row.last_check_outcome).toBeNull();
  });
  vi.unstubAllGlobals();
});

it('does nothing at all without a provider token, rather than failing the cron', async () => {
  const env = testEnv({ SPRITES_TOKEN: undefined });
  const id = await asOwner(sql => seed(sql));
  const fetchFake = vi.fn(ok);
  vi.stubGlobal('fetch', fetchFake);

  await expect(sweepRuntimeLiveness(env)).resolves.toBe(0);
  expect(fetchFake).not.toHaveBeenCalled();
  await asOwner(async sql => {
    const [row] = await sql<{ last_check_outcome: string | null }[]>`
      select last_check_outcome from agent_runtime where id = ${id}`;
    expect(row.last_check_outcome).toBeNull();
  });
  vi.unstubAllGlobals();
});
