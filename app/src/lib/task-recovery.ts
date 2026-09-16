import type { Repository, RunResult } from '@/lib/repo';
import { isRunId } from '@/lib/task';
import { browserHandoff, type BrowserHandoffReason } from '@/lib/browser-handoff';
import { connectionHandoff } from '@/lib/connection-handoff';

export type TaskRecoveryRequest = 'google_calendar' | BrowserHandoffReason | 'input';
export type TaskRecoveryStatus = 'ready' | 'calendar_missing' | 'paused' | 'unavailable'
  | 'changed' | 'working' | 'approval' | 'finished';
export interface TaskRecoveryCheck {
  status: TaskRecoveryStatus;
  sessionId?: string;
}

/** Read setup state only. A connection row or hand-back is NOT proof of live
 * account access, nor permission to execute the original task. */
export async function checkTaskRecovery(
  repo: Pick<Repository, 'runResult' | 'connections' | 'businessBrowser'>,
  runId: string,
  request: TaskRecoveryRequest,
  signal?: AbortSignal,
): Promise<TaskRecoveryCheck> {
  if (!isRunId(runId) || signal?.aborted) return { status: 'unavailable' };
  const result: RunResult = await repo.runResult(runId);
  if (signal?.aborted) return { status: 'unavailable' };
  if (result.runId !== runId || result.summaryOnly || typeof result.pending !== 'boolean') {
    return { status: 'unavailable' };
  }
  if (result.status === 'needs_approval' || result.taskStatus === 'needs_approval' || result.approvalId) {
    return { status: 'approval' };
  }
  if (result.pending) return { status: 'working' };
  if (result.status !== 'completed') return { status: 'changed' };
  if (result.taskStatus === 'completed') return { status: 'finished' };
  if (result.taskStatus && !['needs_input', 'blocked'].includes(result.taskStatus)) {
    return { status: 'changed' };
  }
  const connection = connectionHandoff(result.text ?? '', runId);
  const browser = browserHandoff(connection.text, runId);
  // Revalidate the current response, not a stale/edited local chat bubble.
  const sameRequest = request === 'google_calendar' ? Boolean(connection.connector)
    : request === 'input' ? !connection.connector && !browser.reason && Boolean(result.taskStatus)
      : !connection.connector && browser.reason === request;
  if (!sameRequest) return { status: 'changed' };

  const sessionId = typeof result.sessionId === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(result.sessionId)
    ? result.sessionId : undefined;
  if (request === 'input') return { status: 'ready', sessionId };
  if (request === 'google_calendar') {
    const connections = await repo.connections();
    if (signal?.aborted) return { status: 'unavailable' };
    if (!connections.some(row => ['google', 'google_calendar'].includes(row.connector) && row.status === 'connected')) {
      return { status: 'calendar_missing' };
    }
  }
  const state = signal ? await repo.businessBrowser(undefined, signal) : await repo.businessBrowser();
  if (signal?.aborted) return { status: 'unavailable' };
  if (state.paused === true || state.controlled === true) return { status: 'paused' };
  if (state.paused !== false || (request !== 'google_calendar' && state.enabled !== true)) {
    return { status: 'unavailable' };
  }
  return { status: 'ready', sessionId };
}
