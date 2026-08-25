import { TOOL_RISK } from './data/risk';
import type { BusinessSnapshot } from '@/lib/repo/types';

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

export function getPolicies(snap: BusinessSnapshot): Record<string, Policy> {
  const out: Record<string, Policy> = {};
  for (const op of OPERATIONS) out[op] = snap.permissions[op] ?? DEFAULTS[op];
  return out;
}

export function policyFor(snap: BusinessSnapshot, op: string): Policy {
  return snap.permissions[op] ?? defaultPolicy(op);
}

/** True when the owner has moved an operation off its default. */
export function isCustomised(snap: BusinessSnapshot, op: string): boolean {
  return op in snap.permissions && snap.permissions[op] !== defaultPolicy(op);
}
