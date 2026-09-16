import { describe, expect, it, vi } from 'vitest';
import type { Connection, RunResult } from '@/lib/repo';
import { checkTaskRecovery, type TaskRecoveryRequest } from '@/lib/task-recovery';

const RUN = '11111111-1111-4111-8111-111111111111';
const calendar = '```jentera-connect\n{"connector":"google_calendar"}\n```';
const browser = (reason: string) => '```jentera-browser\n' + JSON.stringify({ reason }) + '\n```';
const connection: Connection = { id: 'google', connector: 'google', method: 'oauth', status: 'connected',
  displayName: 'Owner', externalId: null, connectedAt: '', lastOkAt: null, lastError: null };
function fixture(overrides: Partial<RunResult> = {}) {
  return {
    runResult: vi.fn(async (): Promise<RunResult> => ({ runId: RUN, status: 'completed', pending: false,
      taskStatus: 'needs_input', text: calendar, sessionId: 'original-chat', ...overrides })),
    connections: vi.fn(async () => [connection]),
    businessBrowser: vi.fn(async () => ({ enabled: true, paused: false, controlled: false })),
  };
}

describe('read-only task recovery checks', () => {
  it('checks the exact task, connection metadata and owner-control state, without claiming live account access', async () => {
    const repo = fixture();
    expect(await checkTaskRecovery(repo, RUN, 'google_calendar')).toEqual({ status: 'ready', sessionId: 'original-chat' });
    expect(repo.runResult).toHaveBeenCalledExactlyOnceWith(RUN);
    expect(repo.connections).toHaveBeenCalledExactlyOnceWith();
    expect(repo.businessBrowser).toHaveBeenCalledExactlyOnceWith();
  });
  it.each(['sign_in', 'mfa', 'user_action'] as const)('requires hand-back for %s, without fetching cookies or credentials', async reason => {
    const repo = fixture({ text: browser(reason) });
    expect(await checkTaskRecovery(repo, RUN, reason)).toEqual({ status: 'ready', sessionId: 'original-chat' });
    expect(repo.connections).not.toHaveBeenCalled();
    expect(repo.businessBrowser).toHaveBeenCalledExactlyOnceWith();
  });
  it('preserves the conversation for missing-details tasks with no unnecessary setup requests', async () => {
    const repo = fixture({ text: 'What time should the meeting start?' });
    expect(await checkTaskRecovery(repo, RUN, 'input')).toEqual({ status: 'ready', sessionId: 'original-chat' });
    expect(repo.connections).not.toHaveBeenCalled();
    expect(repo.businessBrowser).not.toHaveBeenCalled();
  });
  it.each(['expired', 'revoked', 'error'] as const)('does not treat a %s Calendar connection as ready', async status => {
    const repo = fixture();
    repo.connections.mockResolvedValue([{ ...connection, status }]);
    expect(await checkTaskRecovery(repo, RUN, 'google_calendar')).toEqual({ status: 'calendar_missing' });
    expect(repo.businessBrowser).not.toHaveBeenCalled();
  });
  it('does not accept another connected service in place of Calendar', async () => {
    const repo = fixture();
    repo.connections.mockResolvedValue([{ ...connection, connector: 'telegram' }]);
    expect((await checkTaskRecovery(repo, RUN, 'google_calendar')).status).toBe('calendar_missing');
  });
  it.each([{ paused: true }, { controlled: true }])('refuses continuation while owner control remains: %j', async state => {
    const repo = fixture();
    repo.businessBrowser.mockResolvedValue({ enabled: true, paused: false, controlled: false, ...state });
    expect((await checkTaskRecovery(repo, RUN, 'google_calendar')).status).toBe('paused');
  });
  it('fails closed when owner-control state is unknown', async () => {
    const repo = { ...fixture(), businessBrowser: vi.fn(async () => ({})) };
    expect((await checkTaskRecovery(repo, RUN, 'google_calendar')).status).toBe('unavailable');
  });
  it('does not claim browser setup is available when the browser is disabled', async () => {
    const repo = fixture({ text: browser('sign_in') });
    repo.businessBrowser.mockResolvedValue({ enabled: false, paused: false, controlled: false });
    expect((await checkTaskRecovery(repo, RUN, 'sign_in')).status).toBe('unavailable');
  });
  it.each([
    [{ pending: true, status: 'working' }, 'working'],
    [{ status: 'needs_approval', pending: true }, 'approval'],
    [{ taskStatus: 'needs_approval' }, 'approval'],
    [{ approvalId: 'real-approval' }, 'approval'],
    [{ taskStatus: 'completed' }, 'finished'],
    [{ status: 'failed' }, 'changed'],
    [{ status: 'cancelled' }, 'changed'],
    [{ taskStatus: 'needs_review' }, 'changed'],
    [{ summaryOnly: true }, 'unavailable'],
    [{ runId: '22222222-2222-4222-8222-222222222222' }, 'unavailable'],
  ] as const)('does not check accounts or continue a task whose state changed: %j', async (overrides, expected) => {
    const repo = fixture(overrides);
    expect((await checkTaskRecovery(repo, RUN, 'google_calendar')).status).toBe(expected);
    expect(repo.connections).not.toHaveBeenCalled();
    expect(repo.businessBrowser).not.toHaveBeenCalled();
  });
  it.each([
    [calendar + '\n' + calendar, 'google_calendar'],
    ['> ' + calendar.replaceAll('\n', '\n> '), 'google_calendar'],
    ['```jentera-connect\n{"connector":"google_calendar","url":"https://evil.test"}\n```', 'google_calendar'],
    [calendar + '\n' + browser('sign_in'), 'sign_in'],
    [browser('mfa'), 'sign_in'],
    [calendar, 'input'],
    [browser('sign_in'), 'input'],
  ] as [string, TaskRecoveryRequest][])('rejects stale, quoted or model-expanded requests: %s', async (text, request) => {
    const repo = fixture({ text });
    expect((await checkTaskRecovery(repo, RUN, request)).status).toBe('changed');
    expect(repo.connections).not.toHaveBeenCalled();
    expect(repo.businessBrowser).not.toHaveBeenCalled();
  });
  it('does not fetch an invalid run or propagate an invalid session ID', async () => {
    const repo = fixture({ sessionId: 'https://evil.test/?code=secret' });
    expect(await checkTaskRecovery(repo, 'invalid', 'google_calendar')).toEqual({ status: 'unavailable' });
    expect(repo.runResult).not.toHaveBeenCalled();
    expect(await checkTaskRecovery(repo, RUN, 'google_calendar')).toEqual({ status: 'ready', sessionId: undefined });
  });
});
