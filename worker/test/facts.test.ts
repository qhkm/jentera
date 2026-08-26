/* ============================================================
   Business memory, and specifically its correction semantics.

   The interesting property is not "a fact can be stored" — it is that
   correcting one never loses what was believed before, never leaves
   two live rows, and never leaves none. All three are invisible until
   a real partial unique index is enforcing them.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { asApp, asOwner, asTenant, truncateAll } from './harness';
import {
  confirmFact,
  factHistory,
  forgetFact,
  keyProblem,
  liveFacts,
  recordFact,
} from '../src/facts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let userId: string;

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    const [u] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true)
      returning id`;
    userId = u.id;
  });
});

describe('recording facts', () => {
  it('stores value, source and confidence', async () => {
    await asTenant(A, (tx) =>
      recordFact(tx, A, {
        key: 'hours.monday',
        value: { open: '09:00', close: '18:00' },
        source: 'owner',
        confirmedBy: userId,
      }),
    );

    const [fact] = await asTenant(A, (tx) => liveFacts(tx));
    expect(fact.key).toBe('hours.monday');
    expect(fact.value).toEqual({ open: '09:00', close: '18:00' });
    expect(fact.source).toBe('owner');
    expect(fact.confidence).toBe(1);
    expect(fact.confirmed).toBe(true);
    expect(fact.version).toBe(1);
  });

  it('stores jsonb as jsonb, not as a string of JSON', async () => {
    // The same trap as channels/connections. recordFact uses tx.json.
    await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'menu.items', value: ['nasi lemak', 'teh tarik'], source: 'import' }),
    );
    const [row] = await asTenant(
      A,
      (tx) => tx`select jsonb_typeof(value) as kind, value from business_fact where live`,
    );
    expect(row.kind).toBe('array');
    expect(row.value).toEqual(['nasi lemak', 'teh tarik']);
  });

  it('keeps an agent guess distinguishable from an owner statement', async () => {
    await asTenant(A, (tx) =>
      recordFact(tx, A, {
        key: 'service.consult.price',
        value: 150,
        source: 'agent',
        sourceRef: 'https://example.com/pricing',
        confidence: 0.62,
      }),
    );
    const [fact] = await asTenant(A, (tx) => liveFacts(tx));
    expect(fact.source).toBe('agent');
    expect(fact.sourceRef).toBe('https://example.com/pricing');
    expect(fact.confidence).toBeCloseTo(0.62, 5);
    // Nobody has vouched for it yet — that is a separate act.
    expect(fact.confirmed).toBe(false);
  });
});

describe('corrections', () => {
  it('supersedes rather than overwrites', async () => {
    await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'hours.monday', value: '9-6', source: 'agent', confidence: 0.5 }),
    );
    await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'hours.monday', value: '10-7', source: 'owner', confirmedBy: userId }),
    );

    const live = await asTenant(A, (tx) => liveFacts(tx));
    expect(live).toHaveLength(1);
    expect(live[0].value).toBe('10-7');
    expect(live[0].version).toBe(2);

    const history = await asTenant(A, (tx) => factHistory(tx, A, 'hours.monday'));
    expect(history.map((f) => [f.version, f.value])).toEqual([
      [2, '10-7'],
      [1, '9-6'],
    ]);
  });

  it('leaves exactly one live row after many corrections', async () => {
    for (let i = 1; i <= 5; i++) {
      await asTenant(A, (tx) =>
        recordFact(tx, A, { key: 'hours.monday', value: `v${i}`, source: 'owner' }),
      );
    }
    const [{ count }] = await asOwner(
      (sql) => sql<{ count: string }[]>`
        select count(*)::text from business_fact where live and key = 'hours.monday'`,
    );
    expect(Number(count)).toBe(1);

    const history = await asTenant(A, (tx) => factHistory(tx, A, 'hours.monday'));
    expect(history).toHaveLength(5);
    expect(history[0].version).toBe(5);
  });

  it('stamps superseded_at on the retired row and leaves it null on the live one', async () => {
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'k.one', value: 'a', source: 'owner' }));
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'k.one', value: 'b', source: 'owner' }));

    const rows = await asOwner(
      (sql) => sql<{ version: number; live: boolean; superseded_at: Date | null }[]>`
        select version, live, superseded_at from business_fact
         where key = 'k.one' order by version`,
    );
    expect(rows[0]).toMatchObject({ version: 1, live: false });
    expect(rows[0].superseded_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ version: 2, live: true });
    expect(rows[1].superseded_at).toBeNull();
  });

  it('refuses a second live row for the same key', async () => {
    /* Guards the index itself. If someone later "optimises" recordFact
       into a plain insert, this is what stops it reaching production. */
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'k.dup', value: 1, source: 'owner' }));
    await expect(
      asTenant(A, (tx) =>
        tx`insert into business_fact (business_id, key, value, source, version)
           values (${A}, 'k.dup', '2'::jsonb, 'owner', 2)`,
      ),
    ).rejects.toThrow(/business_fact_live|duplicate key/i);
  });

  it('does not collide across keys or tenants', async () => {
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'shared.key', value: 'a', source: 'owner' }));
    await asTenant(B, (tx) => recordFact(tx, B, { key: 'shared.key', value: 'b', source: 'owner' }));

    expect((await asTenant(A, (tx) => liveFacts(tx)))[0].value).toBe('a');
    expect((await asTenant(B, (tx) => liveFacts(tx)))[0].value).toBe('b');
  });
});

describe('confirmation', () => {
  it('marks the live row without changing confidence', async () => {
    await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'hours.tue', value: '9-5', source: 'agent', confidence: 0.4 }),
    );
    const ok = await asTenant(A, (tx) => confirmFact(tx, A, 'hours.tue', userId));
    expect(ok).toBe(true);

    const [fact] = await asTenant(A, (tx) => liveFacts(tx));
    expect(fact.confirmed).toBe(true);
    // Still 0.4: a human vouching does not retroactively make the
    // model's guess a confident one.
    expect(fact.confidence).toBeCloseTo(0.4, 5);
  });

  it('does not carry confirmation forward to a correction', async () => {
    /* A new value has not been vouched for just because the previous
       one was. Carrying it over would let an agent launder an
       unreviewed change through an old confirmation. */
    await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'hours.wed', value: '9-5', source: 'owner', confirmedBy: userId }),
    );
    await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'hours.wed', value: '11-8', source: 'agent', confidence: 0.5 }),
    );
    const [fact] = await asTenant(A, (tx) => liveFacts(tx));
    expect(fact.value).toBe('11-8');
    expect(fact.confirmed).toBe(false);
  });

  it('reports false for a key that is not live', async () => {
    expect(await asTenant(A, (tx) => confirmFact(tx, A, 'never.existed', userId))).toBe(false);
  });
});

describe('forgetting', () => {
  it('removes the fact from live but keeps the trail', async () => {
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'gone.key', value: 'x', source: 'owner' }));
    expect(await asTenant(A, (tx) => forgetFact(tx, A, 'gone.key'))).toBe(true);

    expect(await asTenant(A, (tx) => liveFacts(tx))).toHaveLength(0);
    expect(await asTenant(A, (tx) => factHistory(tx, A, 'gone.key'))).toHaveLength(1);
  });

  it('lets the key be recorded again, at the next version', async () => {
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'again.key', value: 1, source: 'owner' }));
    await asTenant(A, (tx) => forgetFact(tx, A, 'again.key'));
    const fact = await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'again.key', value: 2, source: 'owner' }),
    );
    // Version 2, not 1: the history is continuous even across a delete.
    expect(fact.version).toBe(2);
  });
});

describe('tenant isolation', () => {
  it('hides another tenant’s facts', async () => {
    await asTenant(B, (tx) => recordFact(tx, B, { key: 'secret.key', value: 'b', source: 'owner' }));
    expect(await asTenant(A, (tx) => liveFacts(tx))).toHaveLength(0);
    expect(await asTenant(A, (tx) => factHistory(tx, A, 'secret.key'))).toHaveLength(0);
  });

  it('returns nothing with no tenant set', async () => {
    await asTenant(A, (tx) => recordFact(tx, A, { key: 'any.key', value: 1, source: 'owner' }));
    expect(await asApp((sql) => sql`select id from business_fact`)).toHaveLength(0);
  });

  it('cannot write into another tenant', async () => {
    await expect(
      asTenant(A, (tx) => recordFact(tx, B, { key: 'stolen.key', value: 1, source: 'owner' })),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('key validation', () => {
  it('accepts dotted lowercase paths', () => {
    for (const k of ['hours.monday', 'service.consult.price', 'menu', 'a1.b2_c3', 'x-y.z']) {
      expect(keyProblem(k)).toBeNull();
    }
  });

  it('rejects anything that would fragment retrieval', () => {
    // 'Hours.Monday' living alongside 'hours.monday' is the failure.
    for (const k of ['', '  ', 'Hours.Monday', 'hours monday', '.leading', 'trailing.', 'a..b']) {
      expect(keyProblem(k)).not.toBeNull();
    }
    expect(keyProblem('x'.repeat(200))).toMatch(/too long/);
  });
});
