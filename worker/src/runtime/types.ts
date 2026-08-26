/* ============================================================
   Where agent work happens.

   Today every run executes inside the request that triggered it. That
   is a real constraint, not a placeholder: fetch plus one model call
   fits in a Worker invocation, and nothing yet needs longer.

   `run.runtime` has been recording 'worker-inline' since the spine was
   built, as though there were a choice. Nothing dispatched on it. This
   interface makes that column true — the value comes from whichever
   adapter actually ran the work — so adding a second runtime is a new
   implementation rather than an edit to every call site.

   ---

   A deliberate divergence from 2026-08-26-hermes-sprites-runtime.md,
   which specifies `startRun / resumeRun / cancelRun / streamEvents`.

   Those four describe a runtime that outlives the request: you start
   work, come back, and watch it. An inline adapter can implement only
   the first, and would have to stub the rest — an interface whose
   contract nothing verifies, shaped by a runtime that does not exist
   yet. Guessing at it now would be worse than leaving the shape to the
   first implementation that genuinely needs it.

   What this interface does instead is name the two things that vary
   between runtimes today: reading a page, and answering from what is
   known. When a durable runtime arrives it adds the lifecycle methods
   alongside these, and `mode` is how a caller tells which it has.
   ============================================================ */

import type { Candidate } from '../ingest';
import type { Answer } from '../ask';

export interface RetrievedFact {
  key: string;
  value: unknown;
  source: string;
  confidence: number;
  confirmed: boolean;
}

export interface PriorWork {
  objective: string;
  outcome: string | null;
}

/**
 * Agent work, wherever it runs.
 *
 * Every method here is free of side effects on AISAR's own data. The
 * adapter reads and reasons; the control plane decides what to persist
 * and what needs approval. That split is what keeps policy enforceable
 * — a runtime that could write facts or send messages directly would
 * be a runtime that could bypass the approval gate.
 */
export interface RuntimeAdapter {
  /** Recorded in `run.runtime`. Snapshotted per run, never looked up
      again, so history stays truthful after a runtime change. */
  readonly id: string;

  /** Recorded in `run.model`. Null when the work involves no model. */
  readonly model: string | null;

  /**
   * 'inline' finishes inside the triggering request. 'durable' does
   * not, and callers must persist the run before requesting compute.
   * Nothing branches on this yet; it exists so that when something
   * does, the question has an answer rather than an assumption.
   */
  readonly mode: 'inline' | 'durable';

  /** Read a page and propose facts about the business. */
  readPage(url: string): Promise<{ candidates: Candidate[]; title: string; chars: number }>;

  /** Answer a question from confirmed facts and recent work. */
  answerQuestion(
    question: string,
    facts: RetrievedFact[],
    recent: PriorWork[],
  ): Promise<Answer>;
}
