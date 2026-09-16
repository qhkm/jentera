import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import type { RunResult, WorkSummary } from '@/lib/repo';
import TaskDetailView from '../TaskDetailView';

const runId = '11111111-1111-4111-8111-111111111111';
function mount(repo: LocalRepository, props: Partial<Parameters<typeof TaskDetailView>[0]> = {}) {
  return render(<SignedInProvider value account="task-test">
    <RepositoryProvider repository={repo}><I18nProvider>
      <ToastProvider><TaskDetailView runId={runId} {...props} /></ToastProvider>
    </I18nProvider></RepositoryProvider>
  </SignedInProvider>);
}
function taskStatus() {
  return screen.getAllByRole('status').find(node => node.classList.contains('task-status-bar'))!;
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('exact task details', () => {
  it('offers the same display-only browser handoff and recovery in private Activity results', async () => {
    const repo = new LocalRepository();
    const browser = vi.spyOn(repo, 'businessBrowser');
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, taskStatus: 'needs_input',
      text: 'Sign in yourself.\n```jentera-browser\n{"reason":"sign_in"}\n```' }));
    const open = vi.fn();
    const view = mount(repo, { onOpenAsk: open });
    const card = await screen.findByRole('region', { name: 'Sign in to continue' });
    expect(within(card).getByRole('button', { name: 'Open business browser' })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Check setup' })).toBeVisible();
    expect(view.container.textContent).not.toContain('jentera-browser');
    expect(screen.queryByRole('button', { name: 'Provide details in Chat' })).toBeNull();
    expect(browser).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it.each([{ pending: true }, { summaryOnly: true }, { runId: '22222222-2222-4222-8222-222222222222' }])(
    'does not offer private browser handoff or recovery for an ineligible result: %j', async overrides => {
      const repo = new LocalRepository();
      repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, taskStatus: 'needs_input',
        text: '```jentera-browser\n{"reason":"sign_in"}\n```', ...overrides }));
      mount(repo, { onOpenAsk: vi.fn() });
      await screen.findByText('{"reason":"sign_in"}', { selector: 'code' });
      expect(screen.queryByRole('button', { name: 'Open business browser' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Check setup' })).toBeNull();
    });
  it('formats Markdown, lists, code and tables using the safe Chat renderer', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false,
      text: '**Report ready**\n\n- Read the `summary`\n- Review changes\n\n```python\nprint("hello")\n```\n\n| File | Status |\n| --- | --- |\n| report.xlsx | Ready |' }));
    const view = mount(repo);
    expect(await screen.findByText('Report ready', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveTextContent('Review changes');
    expect(screen.getByText('summary', { selector: 'code' })).toHaveClass('reply-code');
    expect(view.container.querySelector('pre.reply-pre > code')).toHaveTextContent('print("hello")');
    expect(screen.getByRole('table')).toHaveTextContent('report.xlsx');
    expect(view.container.querySelector('.task-result-text')).not.toHaveTextContent('```python');
  });
  it('escapes model HTML and refuses executable or credential-bearing links', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false,
      text: '<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n[secret](https://user:password@example.com)\n[Docs](https://example.com/docs)' }));
    const view = mount(repo);
    await screen.findByRole('link', { name: /Docs/ });
    const content = view.container.querySelector('.task-result-text')!;
    expect(content.querySelector('script, img')).toBeNull();
    expect(content).toHaveTextContent('<script>alert(1)</script>');
    expect(within(content as HTMLElement).getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Docs/ })).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('turns the Calendar setup marker into a fixed, explicit connection card without granting access', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.jentera.ai');
    const repo = new LocalRepository();
    const browser = vi.spyOn(repo, 'businessBrowser');
    const request = vi.spyOn(globalThis, 'fetch');
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', taskStatus: 'needs_input', pending: false,
      sessionId: 'original-chat', text: 'Calendar needs access.\n```jentera-connect\n{"connector":"google_calendar"}\n```' }));
    const open = vi.fn();
    const view = mount(repo, { onOpenAsk: open });
    const card = await screen.findByRole('region', { name: 'Connect your calendar' });
    expect(within(card).getByRole('link', { name: 'Connect Google Calendar' }))
      .toHaveAttribute('href', 'https://api.jentera.ai/api/connections/google-calendar/start');
    expect(card).toHaveTextContent('each event still needs your approval');
    expect(view.container.textContent).not.toContain('jentera-connect');
    expect(screen.getAllByRole('status').some(node => node.textContent?.includes('Needs you'))).toBe(true);
    expect(browser).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    repo.connections = vi.fn(async () => [{ id: 'google', connector: 'google', method: 'oauth', status: 'connected' as const,
      displayName: null, externalId: null, connectedAt: '', lastOkAt: null, lastError: null }]);
    browser.mockResolvedValue({ enabled: true, paused: false });
    await userEvent.click(screen.getByRole('button', { name: 'Check setup' }));
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue in Chat' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining('Continue my earlier request:'), 'original-chat'));
    expect(open.mock.calls[0][0]).toContain('First verify');
    expect(open.mock.calls[0][0]).not.toContain('jentera-connect');
  });
  it('copies only the public setup link, never OAuth codes or credentials', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false,
      text: '```jentera-connect\n{"connector":"google_calendar"}\n```' }));
    mount(repo);
    await user.click(await screen.findByRole('button', { name: 'Copy setup link' }));
    expect(copy).toHaveBeenCalledExactlyOnceWith('https://jentera.ai/app?view=business&tab=connections&connector=google');
  });
  it.each([
    '```jentera-connect\n{"connector":"google_calendar","url":"https://example.com"}\n```',
    '```jentera-connect\nnot json\n```',
    '> ```jentera-connect\n> {"connector":"google_calendar"}\n> ```',
    '````markdown\n```jentera-connect\n{"connector":"google_calendar"}\n```\n````',
    '```jentera-connect\n{"connector":"google_calendar"}\n```\n```jentera-connect\n{"connector":"google_calendar"}\n```',
  ])('keeps invalid, duplicate or quoted setup examples as literal Markdown: %s', async text => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, text }));
    const view = mount(repo);
    await screen.findByRole('heading', { name: 'Result' });
    expect(screen.queryByRole('link', { name: 'Connect Google Calendar' })).toBeNull();
    expect(view.container.querySelector('.task-result-text')).toHaveTextContent(text.includes('not json') ? 'not json' : 'google_calendar');
  });
  it.each([
    { pending: true },
    { status: 'failed', taskStatus: 'completed' },
    { runId: '22222222-2222-4222-8222-222222222222' },
    { summaryOnly: true },
  ])('does not offer setup for a pending, failed, mismatched or shared result: %j', async overrides => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false,
      text: '```jentera-connect\n{"connector":"google_calendar"}\n```', ...overrides }));
    const view = mount(repo);
    await screen.findByText('{"connector":"google_calendar"}', { selector: 'code' });
    expect(screen.queryByRole('link', { name: 'Connect Google Calendar' })).toBeNull();
    view.unmount();
  });
  it('does not offer private connection actions in owner review mode', async () => {
    const repo = Object.assign(new LocalRepository(), { taskReviewSummary: vi.fn(async () => ({
      runId, status: 'completed', pending: false, text: '```jentera-connect\n{"connector":"google_calendar"}\n```',
    })) });
    mount(repo, { reviewOnly: true });
    await screen.findByText('{"connector":"google_calendar"}', { selector: 'code' });
    expect(screen.queryByRole('link', { name: 'Connect Google Calendar' })).toBeNull();
  });
  it('prefers Calendar setup over a co-emitted browser prompt, without offering browser takeover', async () => {
    const repo = new LocalRepository();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false,
      text: 'Connect first.\n```jentera-connect\n{"connector":"google_calendar"}\n```\n```jentera-browser\n{"reason":"sign_in"}\n```' }));
    const view = mount(repo);
    await screen.findByRole('link', { name: 'Connect Google Calendar' });
    expect(screen.queryByRole('button', { name: 'Open business browser' })).toBeNull();
    expect(view.container.textContent).not.toContain('jentera-');
  });
  it('localizes the Calendar connection card in Bahasa Malaysia', async () => {
    const repo = new LocalRepository();
    await repo.setLang('bm');
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false,
      text: '```jentera-connect\n{"connector":"google_calendar"}\n```' }));
    mount(repo);
    const card = await screen.findByRole('region', { name: 'Sambungkan kalendar anda' });
    expect(within(card).getByRole('link', { name: 'Sambung Google Calendar' })).toBeInTheDocument();
  });
  it('owner review loads the shared summary without fetching or continuing the private chat', async () => {
    const taskReviewSummary = vi.fn(async () => ({ runId, status: 'completed', taskStatus: 'needs_review',
      pending: false, summaryOnly: true, text: 'Shared business outcome', objective: 'Prepare digest' }));
    const runCoordination = vi.fn();
    const repo = Object.assign(new LocalRepository(), { taskReviewSummary, runCoordination });
    repo.runResult = vi.fn();
    mount(repo, { reviewOnly: true, onOpenAsk: vi.fn() });
    expect(await screen.findByText('Shared business outcome')).toBeInTheDocument();
    expect(screen.getByText(/private conversation and its files are not included/)).toBeInTheDocument();
    expect(repo.runResult).not.toHaveBeenCalled();
    expect(taskReviewSummary).toHaveBeenCalledWith(runId);
    expect(runCoordination).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull();
  });
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
    await waitFor(() => expect(taskStatus()).toHaveTextContent('Done'));
  });
  it('lets the owner mark a task that is waiting on them as done', async () => {
    const confirmTaskReview = vi.fn(async () => {});
    const repo = Object.assign(new LocalRepository(), { confirmTaskReview });
    repo.runResult = vi.fn().mockResolvedValueOnce({ runId, status: 'completed', taskStatus: 'needs_input', pending: false, text: 'Tell me if the digest does not land.' })
      .mockResolvedValue({ runId, status: 'completed', taskStatus: 'completed', pending: false, text: 'Tell me if the digest does not land.' });
    mount(repo);
    const markDone = await screen.findByRole('button', { name: 'Mark as done' });
    expect(taskStatus()).toHaveTextContent('Needs you');
    await userEvent.click(markDone);
    expect(confirmTaskReview).toHaveBeenCalledWith(runId);
    await waitFor(() => expect(taskStatus()).toHaveTextContent('Done'));
  });
  it('lets the owner dismiss a task that is no longer needed', async () => {
    const dismissTask = vi.fn(async () => {});
    const repo = Object.assign(new LocalRepository(), { dismissTask });
    repo.runResult = vi.fn().mockResolvedValueOnce({ runId, status: 'completed', taskStatus: 'needs_input', pending: false, text: 'Which supplier?' })
      .mockResolvedValue({ runId, status: 'completed', taskStatus: 'cancelled', pending: false, text: 'Which supplier?' });
    mount(repo);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss task' }));
    expect(dismissTask).toHaveBeenCalledWith(runId);
    await waitFor(() => expect(taskStatus()).toHaveTextContent('Cancelled'));
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
    expect(taskStatus()).toHaveTextContent('Needs you');
    expect(taskStatus()).not.toHaveTextContent('Done');
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
