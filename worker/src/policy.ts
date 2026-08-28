/* ============================================================
   Which permission governs which action.

   The Permissions screen writes policies under names like `send`. The
   Telegram flow was reading one called `send_message`. Both were
   internally consistent and they never met, so a business that set
   `send` to blocked still had replies drafted and sent on approval —
   a control that silently did nothing.

   Two vocabularies that must agree, with nothing checking, is the
   whole bug. This file is the one place they meet, and the test beside
   it asserts every connector action lands on a permission the screen
   actually offers.
   ============================================================ */

import type postgres from 'postgres';

/** Mirrors app/src/lib/permissions.ts. The test asserts they match. */
export const OPERATIONS = [
  'read',
  'list',
  'export',
  'book',
  'update',
  'send',
  'cancel',
  'refund',
  'pay',
] as const;

export type Operation = (typeof OPERATIONS)[number];
export type Policy = 'automatic' | 'approval' | 'blocked';

/** Mirrors the client's defaults, for when the owner has set nothing. */
export const DEFAULTS: Record<Operation, Policy> = {
  read: 'automatic',
  list: 'automatic',
  export: 'approval',
  book: 'approval',
  update: 'approval',
  send: 'automatic',
  cancel: 'approval',
  refund: 'blocked',
  pay: 'blocked',
};

/**
 * Every action a connector can take, and the permission that governs
 * it.
 *
 * Keyed `connector:action` so two connectors may name the same thing
 * differently and still land on one user-facing control. Adding an
 * action without adding it here fails the test rather than shipping a
 * path no permission covers.
 */
export const GOVERNED_BY: Record<string, Operation> = {
  'telegram:send_message': 'send',
};

export function permissionFor(connector: string, action: string): Operation | null {
  return GOVERNED_BY[`${connector}:${action}`] ?? null;
}

/**
 * What the owner has decided about this action.
 *
 * An action with no mapping returns 'blocked', not 'approval'. An
 * unrecognised action is one nobody has reasoned about, and the safe
 * reading of silence is refusal — not "ask, then do it".
 */
export async function policyFor(
  tx: postgres.TransactionSql,
  connector: string,
  action: string,
): Promise<Policy> {
  const op = permissionFor(connector, action);
  if (!op) return 'blocked';

  const [row] = await tx<{ policy: Policy }[]>`
    select policy from action_policy where op = ${op}`;
  return row?.policy ?? DEFAULTS[op];
}
