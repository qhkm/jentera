/* ============================================================
   Applying an owner's answer to a paused run.

   One path, however the answer arrived. Telegram and the web differ only in
   how the person is bound to the approval — a paired chat and a bot message,
   or a signed-in owner of the same business — and in what they show
   afterwards. Everything between those two ends is identical, and it is
   identical because it lives here rather than being written twice.

   That matters more than tidiness. The sequence has an order the surfaces
   must not be free to reinvent: claim under the business lock so two clicks
   cannot both proceed; tell the runner *before* recording success, because
   the runner is the thing that actually resumes; release the claim if the
   runner cannot be reached, so the approval goes back to pending rather than
   being lost; and only then write the decision and resume the run, in one
   transaction. A second implementation that got that order subtly wrong
   would be a second implementation nobody compared.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import {
  claimRuntimeApprovalDecision,
  completeRuntimeApprovalDecision,
  releaseRuntimeApprovalDecision,
  type RuntimeApproval,
  type RuntimeApprovalBinding,
  type RuntimeTask,
} from './tasks';
import { decideRuntimeTaskApproval } from './run-task';
import { resumeRunAfterApproval } from '../runs';
import { signalRuntimeTask } from './consumer';

export type ApprovalOutcome = 'accepted' | 'duplicate' | 'invalid' | 'unavailable';

export interface ApprovalDecisionResult {
  outcome: ApprovalOutcome;
  task?: RuntimeTask;
  approval?: RuntimeApproval;
}

/**
 * Apply one decision, from whichever surface carried it.
 *
 * `onClaimed` runs after the claim succeeds and before the runner is told —
 * the moment a surface can honestly say "applying", because the decision is
 * now durable but not yet delivered. It must not throw; a surface's feedback
 * is not allowed to fail an approval.
 */
export async function applyRuntimeApprovalDecision(
  env: Env,
  businessId: string,
  binding: RuntimeApprovalBinding,
  decision: 'approve' | 'deny',
  options: { fetch?: typeof globalThis.fetch; onClaimed?: () => Promise<void> } = {},
): Promise<ApprovalDecisionResult> {
  const claim = await withTenant(env, businessId, (tx) =>
    claimRuntimeApprovalDecision(tx, businessId, { ...binding, decision }));

  if (claim.outcome === 'invalid') return { outcome: 'invalid' };

  if (claim.outcome === 'duplicate') {
    /* The same answer arriving twice is not an error — a retried callback, a
       double click, a refreshed tab. Nudge the task so a resume that was
       waiting on the signal still happens, and report it as already done. */
    await signalRuntimeTask(env, businessId, claim.task.id);
    return { outcome: 'duplicate', task: claim.task, approval: claim.approval };
  }

  await options.onClaimed?.().catch(() => undefined);

  try {
    const decided = await decideRuntimeTaskApproval(
      env,
      businessId,
      claim.task.id,
      claim.approval.requestId,
      decision,
      options.fetch,
    );
    if (!decided?.ok) throw new Error('runner approval decision was not accepted');
  } catch (error) {
    /* Back to pending, deliberately. An approval the runner never heard about
       must be answerable again rather than stuck deciding, and the owner
       gets a retryable failure instead of a silent one. */
    await withTenant(env, businessId, (tx) =>
      releaseRuntimeApprovalDecision(tx, businessId, claim.task.id, claim.approval.id));
    console.warn('[runtime] approval decision could not reach runner', {
      businessId,
      taskId: claim.task.id,
      surface: binding.surface,
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'unavailable' };
  }

  const finalized = await withTenant(env, businessId, async (tx) => {
    const approval = await completeRuntimeApprovalDecision(
      tx,
      businessId,
      claim.task.id,
      claim.approval.id,
      decision,
    );
    if (!approval) return null;
    if (claim.task.runId) {
      await resumeRunAfterApproval(tx, businessId, claim.task.runId, decision, {
        runtimeTaskId: claim.task.id,
        requestId: approval.requestId,
        tool: approval.tool,
      });
    }
    return approval;
  });
  if (!finalized) return { outcome: 'unavailable' };

  await signalRuntimeTask(env, businessId, claim.task.id);
  return { outcome: 'accepted', task: claim.task, approval: finalized };
}
