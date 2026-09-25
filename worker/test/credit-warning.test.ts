import { beforeEach, describe, expect, it } from 'vitest';
import { CREDIT_WARNING_SHARE, maybeWarnCredits } from '../src/runtime/credit-warning';
import { asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let owners: string[];

beforeEach(async () => {
  await truncateAll();
  owners = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, plan) values (${A}, 'Kedai', 'retail', 'team')`;
    const rows = await sql<{ id: string; email: string }[]>`insert into app_user (email, email_verified) values
      ('owner@example.com', true), ('partner@example.com', true), ('staff@example.com', true) returning id, email`;
    const by = Object.fromEntries(rows.map((r) => [r.email.split('@')[0], r.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${by.owner}, ${A}, 'owner'), (${by.partner}, ${A}, 'owner'), (${by.staff}, ${A}, 'staff')`;
    /* The shipped defaults: US$5 and 100 hours a month. */
    await sql`insert into runtime_budget (business_id, monthly_cost_microusd, monthly_runtime_seconds)
              values (${A}, 5000000, 360000)`;
    return [by.owner, by.partner].sort();
  });
});

/** One finished run's spend, this month or at a given moment. */
async function spent(costMicrousd: number, runtimeMs = 0, startedAt = 'now()') {
  await asOwner(async (sql) => {
    const [task] = await sql<{ id: string }[]>`
      insert into runtime_task (business_id, kind, status, payload, dedupe_key)
      values (${A}, 'run', 'completed', '{}'::jsonb, ${crypto.randomUUID()}) returning id`;
    await sql`insert into runtime_usage (business_id, runtime_task_id, status, reserved_input_tokens,
                reserved_output_tokens, cost_microusd, runtime_ms, model, started_at)
              values (${A}, ${task.id}, 'completed', 0, 0, ${costMicrousd}, ${runtimeMs}, 'deepseek',
                      ${sql.unsafe(startedAt)})`;
  });
}

const notes = () => asTenant(A, (tx) => tx<{ recipient_user_id: string; kind: string; title: string; body: string }[]>`
  select recipient_user_id, kind, title, body from notification order by recipient_user_id`);

describe('warning the owners before the month’s AI credits run out', () => {
  it('stays quiet below 80%', async () => {
    await spent(3_990_000);
    expect(await asTenant(A, (tx) => maybeWarnCredits(tx, A))).toBe(0);
    expect(await notes()).toHaveLength(0);
  });

  it('tells every owner once at 80%, and staff not at all', async () => {
    expect(CREDIT_WARNING_SHARE).toBe(0.8);
    await spent(4_020_000);
    expect(await asTenant(A, (tx) => maybeWarnCredits(tx, A))).toBe(2);
    const rows = await notes();
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual(owners);
    const [link] = await asTenant(A, (tx) => tx<{ url: string | null }[]>`select url from notification limit 1`);
    expect(link.url).toBe('/app?view=business&tab=profile');
    expect(rows[0]).toMatchObject({
      kind: 'credit_warning',
      title: '80% of this month’s AI credits used',
      body: 'US$4.02 of US$5.00 used. They reset on the 1st. Reply in chat if you need more before then.',
    });
  });

  it('does not repeat within the month', async () => {
    await spent(4_020_000);
    await asTenant(A, (tx) => maybeWarnCredits(tx, A));
    await spent(500_000);
    expect(await asTenant(A, (tx) => maybeWarnCredits(tx, A))).toBe(0);
    expect(await notes()).toHaveLength(2);
  });

  it('counts computer time when that is nearer its cap', async () => {
    await spent(100_000, 82 * 3_600_000);
    expect(await asTenant(A, (tx) => maybeWarnCredits(tx, A))).toBe(2);
    expect((await notes())[0].body)
      .toBe('82.0 of 100 hours of computer time used. They reset on the 1st. Reply in chat if you need more before then.');
  });

  it('ignores last month’s spend', async () => {
    await spent(4_900_000, 0, "date_trunc('month', now()) - interval '1 day'");
    expect(await asTenant(A, (tx) => maybeWarnCredits(tx, A))).toBe(0);
  });

  it('keys the warning by month, so next month can warn again', async () => {
    await spent(4_020_000);
    await asTenant(A, (tx) => maybeWarnCredits(tx, A));
    const [key] = await asTenant(A, (tx) => tx<{ source_key: string; month: string }[]>`
      select source_key, to_char(date_trunc('month', now()), 'YYYY-MM') as month from notification limit 1`);
    expect(key.source_key).toBe(`credit_warning:${key.month}`);
  });
});
