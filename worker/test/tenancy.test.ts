/* ============================================================
   The tenancy boundary, and the bugs that got past it.

   Every test here corresponds to something that actually broke in
   production, or to the invariant that would have caught it. None of
   them pass against a mock: RLS only exists when a real Postgres
   evaluates a real policy for a real non-superuser role.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { asApp, asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    await sql`insert into approval (business_id, connector, op, args, risk)
              values (${A}, 'whatsapp', 'send_invoice', '{"amount":250}'::jsonb, 'medium')`;
    await sql`insert into approval (business_id, connector, op, args, risk)
              values (${B}, 'whatsapp', 'refund', '{"amount":10}'::jsonb, 'high')`;
  });
});

describe('row-level security', () => {
  it('returns nothing when no tenant is set', async () => {
    /* The failure mode this guards is silent: without RLS forced, a
       query with no GUC returns EVERY tenant's rows and looks like it
       worked. */
    const rows = await asApp((sql) => sql`select id from business`);
    expect(rows).toHaveLength(0);

    const approvals = await asApp((sql) => sql`select id from approval`);
    expect(approvals).toHaveLength(0);
  });

  it('shows one tenant only its own rows', async () => {
    const rows = await asTenant(A, (tx) => tx`select name from business`);
    expect(rows.map((r) => r.name)).toEqual(['Alpha']);

    const approvals = await asTenant(A, (tx) => tx`select op from approval`);
    expect(approvals.map((r) => r.op)).toEqual(['send_invoice']);
  });

  it('hides the other tenant even from an explicit id', async () => {
    // Asking for B's row by primary key, while scoped to A.
    const rows = await asTenant(A, (tx) => tx`select name from business where id = ${B}`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a write aimed at another tenant', async () => {
    await expect(
      asTenant(A, (tx) =>
        tx`insert into approval (business_id, connector, op, args, risk)
           values (${B}, 'whatsapp', 'stolen', '{}'::jsonb, 'low')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update another tenant even with a matching predicate', async () => {
    const rows = await asTenant(
      A,
      (tx) => tx`update approval set status = 'approved' where business_id = ${B} returning id`,
    );
    expect(rows).toHaveLength(0);
  });

  it('does not leak the GUC across connections', async () => {
    /* set_config's third argument is `true` — transaction-local. If it
       were ever changed to false the setting would outlive the
       transaction on a pooled connection and hand the next request the
       previous tenant's scope. */
    await asTenant(A, (tx) => tx`select 1`);
    const rows = await asApp((sql) => sql`select id from business`);
    expect(rows).toHaveLength(0);
  });

  it('forces RLS on the owner too, so the policy cannot be bypassed by table ownership', async () => {
    const [row] = await asOwner(
      (sql) => sql`select relforcerowsecurity as forced from pg_class where relname = 'business'`,
    );
    expect(row.forced).toBe(true);
  });
});

describe('creating a business (the RLS bootstrap bug)', () => {
  it('fails when the id is left to the database', async () => {
    /* Reproduces the original 500. The policy covers ALL commands and
       declares no WITH CHECK, so Postgres reuses USING as the insert
       check — and a not-yet-known id can never satisfy it. */
    await expect(
      asApp((sql) => sql`insert into business (name, playbook_key) values ('Nope', 'generic')`),
    ).rejects.toThrow(/row-level security/i);
  });

  it('succeeds when the id is minted first and the transaction scoped to it', async () => {
    const fresh = '33333333-3333-4333-8333-333333333333';
    await asTenant(fresh, async (tx) => {
      await tx`insert into business (id, name, playbook_key)
               values (${fresh}, 'Gamma', 'retail')`;
    });
    const [row] = await asTenant(fresh, (tx) => tx`select name from business`);
    expect(row.name).toBe('Gamma');
  });

  it('still refuses an id that does not match the scope', async () => {
    // The bootstrap fix must not become a hole: scoping to one id and
    // inserting another has to fail.
    await expect(
      asTenant(A, (tx) =>
        tx`insert into business (id, name, playbook_key)
           values ('44444444-4444-4444-8444-444444444444', 'Sneaky', 'generic')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('jsonb columns (the double-encoding bug)', () => {
  it('stores an array as an array, not as a string containing JSON', async () => {
    const channels = ['whatsapp', 'walkin'];
    await asTenant(A, async (tx) => {
      await tx`update business set channels = ${tx.json(channels)} where id = ${A}`;
    });

    const [row] = await asTenant(
      A,
      (tx) => tx`select jsonb_typeof(channels) as kind, channels from business where id = ${A}`,
    );
    expect(row.kind).toBe('array');
    expect(row.channels).toEqual(channels);
  });

  it('demonstrates the bug the fix removed', async () => {
    /* Kept as a live demonstration rather than a comment. If a future
       change makes JSON.stringify safe here, this test fails and the
       fix can be reconsidered — rather than the workaround being
       cargo-culted forever. */
    await asTenant(A, async (tx) => {
      await tx`update business set channels = ${JSON.stringify(['whatsapp'])} where id = ${A}`;
    });
    const [row] = await asTenant(
      A,
      (tx) => tx`select jsonb_typeof(channels) as kind from business where id = ${A}`,
    );
    expect(row.kind).toBe('string');
  });

  it('round-trips an approval payload as an object', async () => {
    const args = { amount: 250, currency: 'MYR', nested: { ok: true } };
    await asTenant(A, async (tx) => {
      await tx`insert into approval (business_id, connector, op, args, risk)
               values (${A}, 'stripe', 'charge', ${tx.json(args)}, 'high')`;
    });
    const [row] = await asTenant(
      A,
      (tx) => tx`select args from approval where op = 'charge'`,
    );
    expect(row.args).toEqual(args);
  });
});

describe('approval decisions', () => {
  it('executes once and only once', async () => {
    const [pending] = await asTenant(A, (tx) => tx`select id from approval where op = 'send_invoice'`);

    const first = await asTenant(
      A,
      (tx) => tx`update approval set status = 'approved', decided_at = now()
                  where id = ${pending.id} and status = 'pending' returning id`,
    );
    const second = await asTenant(
      A,
      (tx) => tx`update approval set status = 'rejected', decided_at = now()
                  where id = ${pending.id} and status = 'pending' returning id`,
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('cannot be decided by the other tenant', async () => {
    const [aRow] = await asOwner(
      (sql) => sql`select id from approval where business_id = ${A}`,
    );
    const rows = await asTenant(
      B,
      (tx) => tx`update approval set status = 'approved'
                  where id = ${aRow.id} and status = 'pending' returning id`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('the run trace', () => {
  const RUN = '55555555-5555-4555-8555-555555555555';

  beforeEach(async () => {
    await asOwner(async (sql) => {
      await sql`insert into run (id, business_id, kind, trigger_shape, runtime)
                values (${RUN}, ${A}, 'ingest', 'owner.ingest.url', 'worker-inline')`;
      await sql`insert into run_event (run_id, business_id, seq, type, payload)
                values (${RUN}, ${A}, 1, 'work.requested', '{}'::jsonb)`;
    });
  });

  it('cannot be edited, ever', async () => {
    /* The trace is the evidence for everything the product claims it
       did. An edit leaves nothing behind that disagrees with it. */
    await expect(
      asTenant(A, (tx) => tx`update run_event set type = 'forged' where run_id = ${RUN}`),
    ).rejects.toThrow(/append-only/i);
  });

  it('can be deleted, so an account can be erased', async () => {
    /* Refusing DELETE too made a business with any history undeletable
       — the cascade from `business` fires the same row-level trigger —
       which broke account closure and erasure requests. Deleting an
       event leaves a gap in a contiguous seq, so tampering by deletion
       is self-reporting in a way editing is not. */
    await expect(
      asOwner((sql) => sql`delete from run_event where run_id = ${RUN}`),
    ).resolves.toBeDefined();
  });

  it('lets a whole business be removed, events and all', async () => {
    await asOwner((sql) => sql`delete from business where id = ${A}`);
    const left = await asOwner((sql) => sql`select 1 from run_event where run_id = ${RUN}`);
    expect(left).toHaveLength(0);
  });
});
