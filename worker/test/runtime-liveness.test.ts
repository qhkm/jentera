import { beforeEach, expect, it } from 'vitest';
import type postgres from 'postgres';
import { asOwner, truncateAll } from './harness';

/* `agent_runtime.status` records the last thing that succeeded and nothing
   ever demotes it, so on 23 September three sprites unreachable since the
   18th still read `error`/`upgrading` and a fourth read `ready` about a host
   Fly had already condemned. These columns answer a different question: when
   did we last look, and what did we see.
   docs/plans/2026-09-23-runtime-liveness.md is the contract. */

beforeEach(async () => { await truncateAll(); });

/** A runtime row is the only fixture these functions need. */
async function seedRuntime(sql: postgres.Sql, overrides: Record<string, unknown> = {}) {
  const businessId = crypto.randomUUID();
  await sql`insert into business (id, name, playbook_key) values (${businessId}, 'Probe Co', 'generic')`;
  const [row] = await sql<{ id: string }[]>`
    insert into agent_runtime (business_id, provider, provider_name, provider_url, status,
      desired_release, observed_release, last_checked_at)
    values (${businessId}, 'fly-sprite', ${'aisar-b-' + businessId.slice(0, 20).replace(/-/g, '')},
      ${'https://sprite.sprites.app'}, 'ready', '2026.09.23-2', '2026.09.23-2',
      ${(overrides.last_checked_at as string | null) ?? null})
    returning id`;
  return { businessId, runtimeId: row.id };
}

it('records when we last looked, separately from when it last worked', async () => {
  await asOwner(async sql => {
  const { runtimeId } = await seedRuntime(sql);

  const [before] = await sql<{ last_checked_at: Date | null; last_ready_at: Date | null }[]>`
    select last_checked_at, last_ready_at from agent_runtime where id = ${runtimeId}`;
  expect(before.last_checked_at).toBeNull();

  await sql`select public.record_runtime_liveness(${runtimeId}, 'reachable')`;
  const [after] = await sql<{ last_checked_at: Date | null; last_check_outcome: string; unhealthy_since: Date | null }[]>`
    select last_checked_at, last_check_outcome, unhealthy_since from agent_runtime where id = ${runtimeId}`;
  expect(after.last_checked_at).not.toBeNull();
  expect(after.last_check_outcome).toBe('reachable');
  expect(after.unhealthy_since).toBeNull();
  });
});

it('unhealthy_since is the age of an outage, not a count of failures', async () => {
  await asOwner(async sql => {
  const { runtimeId } = await seedRuntime(sql);

  const first = '2026-09-18T05:24:00Z';
  await sql`select public.record_runtime_liveness(${runtimeId}, 'unreachable', ${first}::timestamptz)`;
  const [one] = await sql<{ unhealthy_since: Date }[]>`
    select unhealthy_since from agent_runtime where id = ${runtimeId}`;
  expect(one.unhealthy_since.toISOString()).toBe(new Date(first).toISOString());

  // Five more days of failures must not move the start of the outage.
  await sql`select public.record_runtime_liveness(${runtimeId}, 'unreachable', '2026-09-23T10:00:00Z'::timestamptz)`;
  const [still] = await sql<{ unhealthy_since: Date }[]>`
    select unhealthy_since from agent_runtime where id = ${runtimeId}`;
  expect(still.unhealthy_since.toISOString()).toBe(new Date(first).toISOString());

  // One good probe ends it.
  await sql`select public.record_runtime_liveness(${runtimeId}, 'reachable')`;
  const [well] = await sql<{ unhealthy_since: Date | null }[]>`
    select unhealthy_since from agent_runtime where id = ${runtimeId}`;
  expect(well.unhealthy_since).toBeNull();
  });
});

it('refuses an outcome outside the vocabulary rather than inventing a state', async () => {
  await asOwner(async sql => {
  const { runtimeId } = await seedRuntime(sql);

  // The function ignores it; the constraint would refuse a direct write.
  await sql`select public.record_runtime_liveness(${runtimeId}, 'probably fine')`;
  const [row] = await sql<{ last_check_outcome: string | null }[]>`
    select last_check_outcome from agent_runtime where id = ${runtimeId}`;
  expect(row.last_check_outcome).toBeNull();

  await expect(sql`update agent_runtime set last_check_outcome = 'nearly' where id = ${runtimeId}`)
    .rejects.toThrow();
  });
});

it('hands the sweep the longest-unlooked-at first, so a big fleet is covered', async () => {
  await asOwner(async sql => {
  const stale = await seedRuntime(sql, { last_checked_at: '2026-09-18T00:00:00Z' });
  const fresh = await seedRuntime(sql, { last_checked_at: '2026-09-23T10:00:00Z' });
  const never = await seedRuntime(sql);

  const rows = await sql<{ runtime_id: string }[]>`select runtime_id from public.runtime_liveness_targets(100)`;
  const order = rows.map(r => r.runtime_id);
  // Never-checked first, then oldest. Otherwise a fleet larger than one page
  // re-probes the same head of the list forever.
  expect(order[0]).toBe(never.runtimeId);
  expect(order.indexOf(stale.runtimeId)).toBeLessThan(order.indexOf(fresh.runtimeId));
  });
});

it('never hands an untenanted caller anything but what a probe needs', async () => {
  await asOwner(async sql => {
  await seedRuntime(sql);

  const rows = await sql<Record<string, unknown>[]>`select * from public.runtime_liveness_targets(10)`;
  expect(rows.length).toBe(1);
  // No secrets, no release, no error text: a diagnostic must not become a way
  // to read tenant data from a path that has no tenant.
  expect(Object.keys(rows[0]).sort()).toEqual([
    'business_id', 'last_checked_at', 'provider', 'provider_name', 'provider_url',
    'runtime_id', 'unhealthy_since',
  ]);
  });
});

it('leaves a deleted runtime alone', async () => {
  await asOwner(async sql => {
  const { runtimeId } = await seedRuntime(sql);
  await sql`update agent_runtime set deleted_at = now() where id = ${runtimeId}`;

  const rows = await sql`select runtime_id from public.runtime_liveness_targets(10)`;
  expect(rows.length).toBe(0);

  await sql`select public.record_runtime_liveness(${runtimeId}, 'unreachable')`;
  const [row] = await sql<{ last_check_outcome: string | null }[]>`
    select last_check_outcome from agent_runtime where id = ${runtimeId}`;
  expect(row.last_check_outcome).toBeNull();
  });
});
