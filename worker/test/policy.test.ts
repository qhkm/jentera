/* ============================================================
   The permission vocabulary.

   These tests exist because two lists had to agree and nothing checked
   they did: the Permissions screen wrote `send`, the Telegram flow read
   `send_message`, and a business that blocked sending still had
   replies drafted and delivered on approval.

   A control that silently does nothing is worse than no control, so
   the agreement is asserted rather than assumed.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { asOwner, asTenant, truncateAll } from './harness';
import { DEFAULTS, GOVERNED_BY, OPERATIONS, permissionFor, policyFor } from '../src/policy';

const A = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await truncateAll();
  await asOwner(
    (sql) => sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`,
  );
});

describe('the two vocabularies agree', () => {
  /* Read from the client source rather than duplicated here. A copy
     would drift in exactly the way the bug drifted. */
  const client = readFileSync(
    new URL('../../app/src/lib/permissions.ts', import.meta.url).pathname,
    'utf8',
  );

  it('the worker knows the same operations the screen offers', () => {
    const listed = client
      .slice(client.indexOf('export const OPERATIONS'), client.indexOf('] as const'))
      .match(/'([a-z]+)'/g)
      ?.map((q) => q.replaceAll("'", ''));
    expect(listed).toBeDefined();
    expect([...OPERATIONS].sort()).toEqual([...listed!].sort());
  });

  it('the worker defaults match the screen defaults', () => {
    for (const op of OPERATIONS) {
      // e.g. `send: 'automatic',` in the client's DEFAULTS
      const found = client.match(new RegExp(`\\b${op}:\\s*'(automatic|approval|blocked)'`));
      expect(found, `${op} missing from client defaults`).not.toBeNull();
      expect(DEFAULTS[op], `${op} default differs`).toBe(found![1]);
    }
  });

  it('every connector action maps to an operation the screen offers', () => {
    /* The regression. A connector action governed by a name the screen
       does not show is a permission nobody can set. */
    for (const [action, op] of Object.entries(GOVERNED_BY)) {
      expect(OPERATIONS, `${action} maps to unknown operation ${op}`).toContain(op);
    }
  });

  it('maps the Telegram reply to the send permission', () => {
    expect(permissionFor('telegram', 'send_message')).toBe('send');
  });
});

describe('resolving a policy', () => {
  it('falls back to the default when the owner has set nothing', async () => {
    expect(await asTenant(A, (tx) => policyFor(tx, 'telegram', 'send_message'))).toBe('automatic');
  });

  it('honours what the owner set', async () => {
    for (const level of ['automatic', 'blocked', 'approval'] as const) {
      await asTenant(
        A,
        (tx) => tx`insert into action_policy (business_id, op, policy)
                   values (${A}, 'send', ${level})
                   on conflict (business_id, op) do update set policy = excluded.policy`,
      );
      expect(await asTenant(A, (tx) => policyFor(tx, 'telegram', 'send_message'))).toBe(level);
    }
  });

  it('blocks an action nobody has mapped', async () => {
    /* Silence about an unrecognised action means nobody reasoned about
       it, and the safe reading of that is refusal — not "ask, then do
       it anyway". */
    expect(await asTenant(A, (tx) => policyFor(tx, 'telegram', 'delete_everything'))).toBe('blocked');
    expect(await asTenant(A, (tx) => policyFor(tx, 'whatsapp', 'send_message'))).toBe('blocked');
  });

  it('does not read another business’s policy', async () => {
    const B = '22222222-2222-4222-8222-222222222222';
    await asOwner(
      (sql) => sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`,
    );
    await asTenant(
      B,
      (tx) => tx`insert into action_policy (business_id, op, policy) values (${B}, 'send', 'automatic')`,
    );
    // A has set nothing, so it must see its own default, not B's choice.
    expect(await asTenant(A, (tx) => policyFor(tx, 'telegram', 'send_message'))).toBe('automatic');
  });
});
