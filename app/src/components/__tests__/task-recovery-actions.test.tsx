import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRecoveryActions } from '@/components/TaskRecoveryActions';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { RunResult } from '@/lib/repo';
import type { TaskRecoveryRequest } from '@/lib/task-recovery';

const RUN = '11111111-1111-4111-8111-111111111111';
const marker = '```jentera-connect\n{"connector":"google_calendar"}\n```';
function fixture() {
  const repo = new LocalRepository();
  repo.runResult = vi.fn(async (): Promise<RunResult> => ({ runId: RUN, status: 'completed', pending: false,
    taskStatus: 'needs_input', text: marker, sessionId: 'original-chat' }));
  repo.connections = vi.fn(async () => [{ id: 'google', connector: 'google', method: 'oauth', status: 'connected' as const,
    displayName: null, externalId: null, connectedAt: '', lastOkAt: null, lastError: null }]);
  repo.businessBrowser = vi.fn(async () => ({ enabled: true, paused: false }));
  return repo;
}
function mount(repo = fixture(), onContinue = vi.fn(), signedIn = true, request: TaskRecoveryRequest = 'google_calendar') {
  const view = render(<SignedInProvider value={signedIn} account="recovery-test">
    <RepositoryProvider repository={repo}><I18nProvider>
      <TaskRecoveryActions runId={RUN} request={request} title="Check my calendar" onContinue={onContinue} />
    </I18nProvider></RepositoryProvider>
  </SignedInProvider>);
  return { ...view, repo, onContinue };
}
beforeEach(() => localStorage.clear());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('explicit task setup recovery', () => {
  it('does not check, execute, or continue on mount, focus or visibility changes', async () => {
    const { repo, onContinue } = mount();
    await screen.findByRole('button', { name: 'Check setup' });
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(repo.runResult).not.toHaveBeenCalled();
    expect(repo.connections).not.toHaveBeenCalled();
    expect(repo.businessBrowser).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });
  it('checks read-only setup, then rechecks before preparing a safe draft for the original conversation', async () => {
    const user = userEvent.setup();
    const { repo, onContinue } = mount();
    const ask = vi.spyOn(repo, 'ask');
    const disconnect = vi.spyOn(repo, 'disconnect');
    await user.click(await screen.findByRole('button', { name: 'Check setup' }));
    expect(await screen.findByText(/must still verify live Calendar access/)).toBeVisible();
    expect(onContinue).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue in Chat' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(expect.stringContaining('Continue my earlier request: Check my calendar'), 'original-chat'));
    expect(onContinue.mock.calls[0][0]).toContain('do not repeat completed actions');
    expect(onContinue.mock.calls[0][0]).toContain('Ask for approval');
    expect(onContinue.mock.calls[0][0]).not.toContain('jentera-connect');
    expect(repo.runResult).toHaveBeenCalledTimes(2);
    expect(repo.businessBrowser).toHaveBeenCalledTimes(2);
    expect(ask).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });
  it('does not prepare a draft if browser control changes after a successful check', async () => {
    const user = userEvent.setup();
    const { repo, onContinue } = mount();
    await user.click(await screen.findByRole('button', { name: 'Check setup' }));
    await screen.findByRole('button', { name: 'Continue in Chat' });
    vi.mocked(repo.businessBrowser).mockResolvedValue({ enabled: true, paused: true });
    await user.click(screen.getByRole('button', { name: 'Continue in Chat' }));
    expect(await screen.findByText(/still under owner control/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue in Chat' })).toBeNull();
    expect(onContinue).not.toHaveBeenCalled();
    expect(repo.connections).toHaveBeenCalledTimes(2);
    expect(repo.businessBrowser).toHaveBeenCalledTimes(2);
  });
  it('does not expose raw authentication/provider errors and allows an explicit retry', async () => {
    const user = userEvent.setup();
    const repo = fixture();
    vi.mocked(repo.connections).mockRejectedValueOnce(new Error('https://provider.test/?code=SECRET'));
    const { container, onContinue } = mount(repo);
    await user.click(await screen.findByRole('button', { name: 'Check setup' }));
    expect(await screen.findByText(/Nothing was sent or changed/)).toBeVisible();
    expect(container.textContent).not.toContain('SECRET');
    expect(onContinue).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('button', { name: 'Continue in Chat' })).toBeVisible();
  });
  it('bounds a stalled check and ignores a late result', async () => {
    const repo = fixture();
    let resolve!: (result: RunResult) => void;
    vi.mocked(repo.runResult).mockReturnValue(new Promise(done => { resolve = done; }));
    const { onContinue } = mount(repo);
    const button = await screen.findByRole('button', { name: 'Check setup' });
    vi.useFakeTimers();
    act(() => button.click());
    expect(screen.getByRole('button', { name: 'Checking setup…' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByText(/Nothing was sent or changed/)).toBeVisible();
    await act(async () => resolve({ runId: RUN, status: 'completed', pending: false, taskStatus: 'needs_input', text: marker }));
    expect(screen.queryByRole('button', { name: 'Continue in Chat' })).toBeNull();
    expect(onContinue).not.toHaveBeenCalled();
    expect(repo.connections).not.toHaveBeenCalled();
    expect(repo.businessBrowser).not.toHaveBeenCalled();
  });
  it('ignores a check that completes after unmount', async () => {
    const user = userEvent.setup();
    const repo = fixture();
    let resolve!: (result: RunResult) => void;
    vi.mocked(repo.runResult).mockReturnValue(new Promise(done => { resolve = done; }));
    const { unmount, onContinue } = mount(repo);
    await user.click(await screen.findByRole('button', { name: 'Check setup' }));
    unmount();
    await act(async () => resolve({ runId: RUN, status: 'completed', pending: false, taskStatus: 'needs_input', text: marker }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(repo.connections).not.toHaveBeenCalled();
    expect(repo.businessBrowser).not.toHaveBeenCalled();
  });
  it('has no recovery controls or reads in the anonymous demo', async () => {
    const { repo } = mount(fixture(), vi.fn(), false);
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    expect(repo.runResult).not.toHaveBeenCalled();
  });
  it('localizes the check and hand-back explanation in Bahasa Malaysia', async () => {
    const user = userEvent.setup();
    const repo = fixture();
    await repo.setLang('bm');
    vi.mocked(repo.businessBrowser).mockResolvedValue({ enabled: true, paused: true });
    mount(repo);
    await user.click(await screen.findByRole('button', { name: 'Semak persediaan' }));
    expect(await screen.findByText(/Pelayar masih di bawah kawalan pemilik/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Semak semula' })).toBeVisible();
  });
});
