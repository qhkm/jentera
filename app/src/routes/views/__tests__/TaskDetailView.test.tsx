import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { RunResult, WorkSummary } from '@/lib/repo';
import TaskDetailView from '../TaskDetailView';

const runId = '11111111-1111-4111-8111-111111111111';
function mount(repo: LocalRepository, props: Partial<Parameters<typeof TaskDetailView>[0]> = {}) {
  return render(<SignedInProvider value account="task-test">
    <RepositoryProvider repository={repo}><I18nProvider>
      <TaskDetailView runId={runId} {...props} />
    </I18nProvider></RepositoryProvider>
  </SignedInProvider>);
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('exact task details', () => {
  it('lists the files the task produced, each as a download', async () => {
    const repo = new LocalRepository();
    repo.artifactUrl = (id: string) => `https://api.test/api/artifacts/${id}`;
    repo.runResult = vi.fn(async () => ({
      runId, status: 'completed', pending: false, text: 'Digest attached.',
      artifacts: [{ id: 'a1', runId, name: 'tech-digest.md', contentType: 'text/markdown', size: 5321, createdAt: '2026-09-12T01:00:00.000Z' }],
    }));
    mount(repo);
    const files = await screen.findByRole('region', { name: 'Files' });
    const link = within(files).getByRole('link', { name: /tech-digest\.md/ });
    expect(link).toHaveAttribute('href', 'https://api.test/api/artifacts/a1');
    expect(link).toHaveAttribute('download', 'tech-digest.md');
  });


  it('confirms reviewed work and reloads its status', async () => {
    const confirmTaskReview = vi.fn(async () => {});
    const repo = Object.assign(new LocalRepository(), { confirmTaskReview });
    repo.runResult = vi.fn().mockResolvedValueOnce({ runId, status: 'completed', taskStatus: 'needs_review', pending: false, text: 'Report ready' })
      .mockResolvedValue({ runId, status: 'completed', taskStatus: 'completed', pending: false, text: 'Report ready' });
    mount(repo);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm task complete' }));
    expect(confirmTaskReview).toHaveBeenCalledWith(runId);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Done'));
  });
  it('lets the owner mark a task that is waiting on them as done', async () => {
    const confirmTaskReview = vi.fn(async () => {});
    const repo = Object.assign(new LocalRepository(), { confirmTaskReview });
    repo.runResult = vi.fn().mockResolvedValueOnce({ runId, status: 'completed', taskStatus: 'needs_input', pending: false, text: 'Tell me if the digest does not land.' })
      .mockResolvedValue({ runId, status: 'completed', taskStatus: 'completed', pending: false, text: 'Tell me if the digest does not land.' });
    mount(repo);
    const markDone = await screen.findByRole('button', { name: 'Mark as done' });
    expect(screen.getByRole('status')).toHaveTextContent('Needs you');
    await userEvent.click(markDone);
    expect(confirmTaskReview).toHaveBeenCalledWith(runId);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Done'));
  });
  it('lets the owner dismiss a task that is no longer needed', async () => {
    const dismissTask = vi.fn(async () => {});
    const repo = Object.assign(new LocalRepository(), { dismissTask });
    repo.runResult = vi.fn().mockResolvedValueOnce({ runId, status: 'completed', taskStatus: 'needs_input', pending: false, text: 'Which supplier?' })
      .mockResolvedValue({ runId, status: 'completed', taskStatus: 'cancelled', pending: false, text: 'Which supplier?' });
    mount(repo);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss task' }));
    expect(dismissTask).toHaveBeenCalledWith(runId);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cancelled'));
    expect(screen.queryByRole('button', { name: 'Dismiss task' })).not.toBeInTheDocument();
  });
  it('opens feedback with the result and original conversation, without approving anything', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', taskStatus: 'needs_review', sessionId: 'original-chat', pending: false, text: 'Report ready' }));
    const open = vi.fn();
    mount(repo, { onOpenAsk: open, title: 'Prepare report' });
    await userEvent.click(await screen.findByRole('button', { name: 'Request changes in Chat' }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('Report ready'), 'original-chat');
  });
  it('shows the authorization instructions without declaring the task done or polling forever', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', taskStatus: 'needs_input',
      pending: false, text: 'Open Cloudflare and authorize this login.' }));
    mount(repo, { title: 'Log in to Cloudflare' });
    expect(await screen.findByText('Open Cloudflare and authorize this login.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Needs you');
    expect(screen.getByRole('status')).not.toHaveTextContent('Done');
    expect(repo.runResult).toHaveBeenCalledOnce();
  });
  it('loads the result without a recent Activity record and moves keyboard focus to its heading', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, text: 'Quotation prepared, not sent.' }));
    mount(repo, { title: 'Prepare a quotation' });
    expect(await screen.findByText('Quotation prepared, not sent.')).toBeInTheDocument();
    expect(repo.runResult).toHaveBeenCalledExactlyOnceWith(runId);
    expect(screen.getByRole('heading', { name: 'Prepare a quotation' })).toHaveFocus();
  });

  it('does not show a cached result or objective after the server rejects a run, and supports retry', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn().mockRejectedValueOnce(new Error('run not found'))
      .mockResolvedValueOnce({ runId, status: 'completed', pending: false, text: 'Now available' });
    mount(repo, { work: { objective: 'Cached objective', outcome: 'Cached result' } as WorkSummary });
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load this task');
    expect(screen.queryByText('Cached result')).not.toBeInTheDocument();
    expect(screen.queryByText('Cached objective')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Now available')).toBeInTheDocument();
  });

  it('rejects malformed links before requesting anything', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn();
    mount(repo, { runId: '../activity' });
    await screen.findByRole('alert');
    expect(repo.runResult).not.toHaveBeenCalled();
  });

  it('refreshes pending work, stops after completion, and clears polling on unmount', async () => {
    const repo = new LocalRepository();
    let finish!: (result: RunResult) => void;
    repo.runResult = vi.fn().mockImplementationOnce(() => new Promise<RunResult>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ runId, status: 'completed', pending: false, text: 'Finished' });
    const view = mount(repo);
    await waitFor(() => expect(repo.runResult).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    await act(async () => finish({ runId, status: 'running', pending: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Finished')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(repo.runResult).toHaveBeenCalledTimes(2);
    view.unmount();
    vi.useRealTimers();

    repo.runResult = vi.fn().mockImplementation(() => new Promise<RunResult>((resolve) => { finish = resolve; }));
    const pending = mount(repo);
    await waitFor(() => expect(repo.runResult).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    await act(async () => finish({ runId, status: 'queued', pending: true }));
    pending.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(repo.runResult).toHaveBeenCalledOnce();
  });

  it('opens the existing approval inbox without claiming an approval belongs to this task', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'needs_approval', pending: true }));
    const back = vi.fn();
    const view = mount(repo, { onBack: back });
    await userEvent.click(await screen.findByRole('button', { name: 'Open approval inbox' }));
    expect(back).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    view.unmount();
  });

  it('labels a stored summary separately and never invents a missing result', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false }));
    const first = mount(repo, { work: { objective: 'Original request', outcome: 'Short recorded summary' } as WorkSummary });
    expect(await screen.findByRole('heading', { name: 'Recorded summary' })).toBeInTheDocument();
    expect(screen.getByText('Short recorded summary')).toBeInTheDocument();
    first.unmount();
    mount(repo);
    expect(await screen.findByText('This task is complete, but no result is available here.')).toBeInTheDocument();
  });
});
