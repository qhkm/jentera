/* ============================================================
   Specialists hand work to each other: the control plane's half.

   docs/plans/2026-09-26-specialist-handoff.md is the contract. The runner
   holds the limits while a task runs; this file decides who may hand off at
   all, writes what the agents are told, and turns the runner's hand-off
   events into the run's durable trace.
   ============================================================ */

import type postgres from 'postgres';
import type { Env } from './env';
import type { SpecialistDefinition } from './specialists';
import { append } from './runs';
import type { RunnerHandoffEvent } from './runtime/runner-client';

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
  /** What every specialist handed part of this task works under besides its
      own lines: the operating rules, who is speaking, the business's
      confirmed facts and the clock (`prepareHermesAgent`'s `handoffBase`). */
  base: string;
}

/** The limits, preamble and base a task start carries to the runner. */
export function handoffTaskField(base: string): HandoffTaskField {
  return { ...HANDOFF_LIMITS, preamble: HANDOFF_PREAMBLE, base };
}

/** What a turn that may hand off is told: who else is on the team and how to credit them. */
export function handoffInstructions(
  roster: readonly Pick<SpecialistDefinition, 'profile' | 'name' | 'description'>[],
  self?: string,
): string {
  const others = roster.filter((entry) => entry.profile !== self);
  if (!others.length) return '';
  const list = others.map((entry) => `- ${entry.profile}: ${entry.name} — ${entry.description}`).join('\n');
  return 'You can hand part of this task to a specialist with the ask_specialist tool: give their ' +
    'profile key and a brief of exactly what you need. Do it only when that part clearly sits in ' +
    `their remit, and one at a time. Specialists on this team:\n${list}\n` +
    'Wait for their answer, then write one reply to the owner that says who did which part, by ' +
    'name (for example "Finance and records checked Bukku: …"). If a specialist could not finish, ' +
    'say which part is missing. Never present a missing part as done.';
}

/** A specialist's step, tagged with its name so the app can say who did it. */
export function agentStep(name: string, detail: string): string {
  const clean = name.replace(/[⟦⟧\r\n]/g, '').trim().slice(0, 60);
  return clean ? `⟦${clean}⟧ ${detail}` : detail;
}

/** What a specialist the business's roster does not name is called. */
export const SPECIALIST_FALLBACK_NAME = 'a specialist';

/** The live status line for a hand-off stage, or null when it needs none.
    A request for someone who is not on the team was never a hand-off the
    owner needs to hear about: the lead is told, and carries on. */
export function handoffStatus(
  stage: RunnerHandoffEvent['stage'],
  name: string,
  code?: RunnerHandoffEvent['code'],
): string | null {
  if (stage === 'refused' && code === 'unknown_specialist') return null;
  if (stage === 'started') return `🤝 Asking ${name}…`;
  if (stage === 'finished') return `✅ ${name} finished their part`;
  if (stage === 'failed' || stage === 'refused') return `⚠️ ${name} could not help with this part`;
  return null;
}

/** The durable record of a hand-off stage. The brief never reaches here. */
export async function recordHandoff(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
  event: RunnerHandoffEvent,
): Promise<void> {
  await append(tx, businessId, runId, 'agent.handoff', {
    stage: event.stage,
    specialist: event.specialist,
    depth: event.depth,
    ...(event.code ? { code: event.code } : {}),
  });
}

/** Specialist names by profile, for a line the runner sent without one. */
export async function specialistNames(tx: postgres.TransactionSql): Promise<Map<string, string>> {
  const rows = await tx<{ profile_key: string; name: string }[]>`
    select profile_key, name from specialist_profile`;
  return new Map(rows.map((row) => [row.profile_key, row.name]));
}
