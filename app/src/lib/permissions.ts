/* ============================================================
   Action policy.

   DISCUSSION_SUMMARY: "Zero setup does not mean zero control."
   Every operation sits at one of three levels:

     automatic  read-only or reversible, low-risk internal work
     approval   customer messages, bookings, exports, record changes
     blocked    payments, destructive operations, anything outside
                the business policy

   This is not a settings screen that describes behaviour elsewhere —
   callTool reads it, so changing a level here changes what the agent
   is actually allowed to do.
   ============================================================ */

import { TOOL_RISK } from './data/risk';
import * as store from './storage';
import { KEYS } from './storage';

export type { Policy } from './types';
import type { Policy } from './types';

/** Operations the tool contract knows about, in the order shown. */
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

/**
 * Defaults follow the summary's three categories rather than the raw
 * risk tier: `export` is low-risk but leaves the business, and
 * `cancel` is high-risk but not destructive enough to block outright.
 */
const DEFAULTS: Record<Operation, Policy> = {
  read: 'automatic',
  list: 'automatic',
  export: 'approval',
  book: 'approval',
  update: 'approval',
  send: 'approval',
  cancel: 'approval',
  refund: 'blocked',
  pay: 'blocked',
};

export function defaultPolicy(op: string): Policy {
  return DEFAULTS[op as Operation] ?? (TOOL_RISK[op] === 'low' ? 'automatic' : 'approval');
}

export function getPolicies(): Record<string, Policy> {
  const stored = store.getJSON<Record<string, Policy>>(KEYS.permissions, {});
  const out: Record<string, Policy> = {};
  for (const op of OPERATIONS) out[op] = stored[op] ?? DEFAULTS[op];
  return out;
}

export function policyFor(op: string): Policy {
  const stored = store.getJSON<Record<string, Policy>>(KEYS.permissions, {});
  return stored[op] ?? defaultPolicy(op);
}

export function setPolicy(op: string, policy: Policy): void {
  const stored = store.getJSON<Record<string, Policy>>(KEYS.permissions, {});
  store.setJSON(KEYS.permissions, { ...stored, [op]: policy });
}

export function resetPolicies(): void {
  store.setJSON(KEYS.permissions, {});
}

/** True when the owner has moved an operation off its default. */
export function isCustomised(op: string): boolean {
  const stored = store.getJSON<Record<string, Policy>>(KEYS.permissions, {});
  return op in stored && stored[op] !== defaultPolicy(op);
}
