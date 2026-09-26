/* ============================================================
   Specialists hand work to each other: the control plane's half.

   docs/plans/2026-09-26-specialist-handoff.md is the contract. The runner
   holds the limits while a task runs; this file decides who may hand off at
   all, writes what the agents are told, and turns the runner's hand-off
   events into the run's durable trace.
   ============================================================ */

import type { Env } from './env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pilot: on only for the businesses listed, and nobody when the list is empty. */
export function handoffEnabledFor(env: Env, businessId: string): boolean {
  const ids = (env.HANDOFF_BUSINESS_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  return env.HANDOFF_ENABLED === 'true' && UUID.test(businessId) &&
    ids.length <= 20 && ids.every((id) => UUID.test(id)) && ids.includes(businessId);
}

export const HANDOFF_LIMITS = { maxDepth: 2, maxHandoffs: 5 } as const;

/** What a specialist is told when a colleague hands it part of a task. */
export const HANDOFF_PREAMBLE =
  "A colleague on this business's Jentera team has handed you part of a task. You are " +
  'answering them, not the owner: do the part they asked for with your own expertise and ' +
  'memory, then reply with what you found or did, plainly and completely, so they can use ' +
  'it in their answer. If you could not finish, say exactly which part is missing and why. ' +
  'Never say something was done when it was not.';

export interface HandoffTaskField {
  maxDepth: number;
  maxHandoffs: number;
  preamble: string;
}

/** The limits and preamble a task start carries to the runner. */
export function handoffTaskField(speakerText?: string): HandoffTaskField {
  return {
    ...HANDOFF_LIMITS,
    preamble: speakerText ? `${HANDOFF_PREAMBLE}\n\n${speakerText}` : HANDOFF_PREAMBLE,
  };
}
