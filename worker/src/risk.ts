/* ============================================================
   The risk gate.

   Lifted out of index.ts when the D1 tool-contract routes were retired
   in slice 1. Nothing calls it yet — the run engine that will is slice
   3 — but this is a product rule, not scaffolding, and deleting it with
   its last caller would quietly drop it.

   `pay` and `refund` are BLOCKED, not merely queued for approval:
   TECHNICAL_ARCHITECTURE.md is explicit that payments and destructive
   operations stay off until deliberately enabled. Approval fatigue is
   real, and a queue mixing routine replies with irreversible money
   movement trains an owner to tap through both.

   The client keeps its own copy in app/src/lib/data/risk.ts to predict
   behaviour before a click. This one governs. Keep the two in step.
   ============================================================ */

export type Risk = 'low' | 'medium' | 'high' | 'blocked';

export const TOOL_RISK: Record<string, Risk> = {
  pay: 'blocked',
  refund: 'blocked',
  send: 'high',
  cancel: 'high',
  update: 'medium',
  book: 'medium',
  read: 'low',
  list: 'low',
  export: 'low',
};

/** Unknown operations default to medium — never to low. */
export function riskOf(op: string): Risk {
  return TOOL_RISK[op] ?? 'medium';
}
