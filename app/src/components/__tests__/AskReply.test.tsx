import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AskReply } from '@/components/AskReply';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { AskMessage } from '@/hooks/useAsk';

const RUN = '11111111-1111-4111-8111-111111111111';
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(message: AskMessage, repo = new LocalRepository(), onOpenBusinessBrowser?: () => void) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={repo}>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </RepositoryProvider>
  );
  return render(<AskReply message={message} onOpenActivity={() => {}} onRetry={() => {}} onOpenBusinessBrowser={onOpenBusinessBrowser} />, { wrapper });
}

/* The card is gone. It wrapped a two-minute exchange in a tracked job —
   an eyebrow, a status, a View task link — and made every reply read as
   administration. Work is still reachable from Activity; it is a line in
   the reply's footer rather than a card beneath it. */
describe('AskReply: conversation versus work', () => {
  it('offers the fixed Calendar OAuth route without any browser action or connection write', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.jentera.ai');
    const repo = new LocalRepository();
    const browser = vi.spyOn(repo, 'businessBrowser');
    const request = vi.spyOn(globalThis, 'fetch');
    const open = vi.fn();
    const view = mount({ from: 'ai', state: 'done', runId: RUN,
      text: 'Calendar is not connected.\n```jentera-connect\n{"connector":"google_calendar"}\n```' }, repo, open);
    const card = await screen.findByRole('region', { name: 'Connect your calendar' });
    expect(within(card).getByRole('link', { name: 'Connect Google Calendar' }))
      .toHaveAttribute('href', 'https://api.jentera.ai/api/connections/google-calendar/start');
    expect(within(card).getByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute('target', '_blank');
    expect(within(card).getByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(card).toHaveTextContent('not the business browser');
    expect(card).toHaveTextContent('each event still needs your approval');
    expect(card).toHaveTextContent('hand it back first');
    expect(view.container.textContent).not.toContain('jentera-connect');
    expect(open).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it('copies only a public setup link, never a Google callback or code', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const view = mount({ from: 'ai', state: 'done', runId: RUN,
      text: 'Connect first.\n```jentera-connect\n{"connector":"google_calendar"}\n```' });
    await user.click(await screen.findByRole('button', { name: 'Copy setup link' }));
    expect(copy).toHaveBeenCalledWith('https://jentera.ai/app?view=business&tab=connections&connector=google');
    expect(copy).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Setup link copied/)).toBeVisible();
    expect(localStorage.getItem('jentera.session')).toBeNull();
    view.unmount();
  });
  it('does not copy the setup protocol into the reply clipboard', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    mount({ from: 'ai', state: 'done', runId: RUN,
      text: 'Calendar needs access.\n```jentera-connect\n{"connector":"google_calendar"}\n```' });
    await user.click(await screen.findByRole('button', { name: 'Copy reply' }));
    expect(copy).toHaveBeenCalledWith('Calendar needs access.');
  });
  it('prefers Calendar setup if the agent mistakenly also emits a browser handoff', async () => {
    const view = mount({ from: 'ai', state: 'done', runId: RUN,
      text: 'Connect first.\n```jentera-connect\n{"connector":"google_calendar"}\n```\n```jentera-browser\n{"reason":"sign_in"}\n```' }, new LocalRepository(), vi.fn());
    expect(await screen.findByRole('link', { name: 'Connect Google Calendar' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open business browser' })).toBeNull();
    expect(view.container.textContent).not.toContain('jentera-');
  });
  it.each([true, false])('hides %s-complete streamed Calendar setup without offering a link', async complete => {
    const view = mount({ from: 'ai', state: 'streaming', pendingId: 'p1', runId: RUN,
      text: 'Calendar needs access.\n```jentera-connect\n{"connector":"google_calendar"}' + (complete ? '\n```' : '') });
    expect(await screen.findByText('Calendar needs access.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Connect Google Calendar' })).toBeNull();
    expect(view.container.textContent).not.toContain('jentera-connect');
  });
  it.each([
    { state: 'failed' as const, failedQuestion: 'Check calendar' },
    { runId: undefined },
    { from: 'you' as const },
    { state: 'working' as const },
    { state: 'needs_approval' as const, pendingId: 'p1', approvalId: 'approval' },
  ])('does not offer Calendar setup in a non-completed agent reply: %j', async overrides => {
    mount({ from: 'ai', state: 'done', runId: RUN,
      text: '```jentera-connect\n{"connector":"google_calendar"}\n```', ...overrides });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Jentera' })).toBeVisible());
    expect(screen.queryByRole('link', { name: 'Connect Google Calendar' })).toBeNull();
  });
  it('localizes Calendar setup in Bahasa Malaysia', async () => {
    const repo = new LocalRepository();
    await repo.setLang('bm');
    mount({ from: 'ai', state: 'done', runId: RUN,
      text: 'Sambungkan dahulu.\n```jentera-connect\n{"connector":"google_calendar"}\n```' }, repo);
    const card = await screen.findByRole('region', { name: 'Sambungkan kalendar anda' });
    expect(within(card).getByRole('link', { name: 'Sambung Google Calendar' })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Salin pautan persediaan' })).toBeVisible();
    expect(card).toHaveTextContent('setiap acara masih memerlukan kelulusan anda');
  });
  it.each(['ios', 'android'])('opens normal web setup with the %s browser plugin without forwarding native tokens', async platform => {
    const user = userEvent.setup();
    const open = vi.fn(async () => undefined);
    const read = vi.fn();
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => platform,
      Plugins: { Browser: { open }, SecureStorage: { internalGetItem: read } } });
    mount({ from: 'ai', state: 'done', runId: RUN,
      text: 'Connect first.\n```jentera-connect\n{"connector":"google_calendar"}\n```' });
    const link = await screen.findByRole('link', { name: 'Connect Google Calendar' });
    expect(link).toHaveAttribute('href', 'https://jentera.ai/app?view=business&tab=connections&connector=google');
    expect(screen.getByRole('region', { name: 'Connect your calendar' })).toHaveTextContent('same Jentera account');
    await user.click(link);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({ url: 'https://jentera.ai/app?view=business&tab=connections&connector=google', toolbarColor: '#242c29' });
    expect(read).not.toHaveBeenCalled();
  });
  it('keeps native setup out of the WebView and explains how to recover if the system browser is unavailable', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} });
    mount({ from: 'ai', state: 'done', runId: RUN,
      text: 'Connect first.\n```jentera-connect\n{"connector":"google_calendar"}\n```' });
    await user.click(await screen.findByRole('link', { name: 'Connect Google Calendar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the system browser');
  });
  it.each([
    ['sign_in', 'Sign in to continue'],
    ['mfa', 'Complete verification'],
    ['user_action', 'Your help is needed'],
  ])('offers a browser viewer for a completed %s request, never taking control itself', async (reason, title) => {
    const user = userEvent.setup();
    const open = vi.fn();
    const repo = new LocalRepository();
    const browser = vi.spyOn(repo, 'businessBrowser');
    const text = 'The website needs your help.\n```jentera-browser\n' + JSON.stringify({ reason }) + '\n```';
    const view = mount({ from: 'ai', text, state: 'done', runId: RUN }, repo, open);
    const card = await screen.findByRole('region', { name: title });
    expect(card).toHaveTextContent('Hand back to Jentera');
    expect(card).toHaveTextContent('never in Chat');
    expect(view.container.textContent).not.toContain('jentera-browser');
    expect(view.container.textContent).not.toContain('"reason"');
    expect(open).not.toHaveBeenCalled();
    await user.click(within(card).getByRole('button', { name: 'Open business browser' }));
    expect(open).toHaveBeenCalledOnce();
    expect(browser).not.toHaveBeenCalled();
  });
  it.each([true, false])('hides a %s-complete streamed handoff without showing an action', async complete => {
    const text = 'Please sign in.\n```jentera-browser\n{"reason":"sign_in"}' + (complete ? '\n```' : '');
    const view = mount({ from: 'ai', text, state: 'streaming', pendingId: 'p1', runId: RUN }, new LocalRepository(), vi.fn());
    expect(await screen.findByText('Please sign in.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open business browser' })).toBeNull();
    expect(view.container.textContent).not.toContain('jentera-browser');
    expect(view.container.textContent).not.toContain('"reason"');
  });
  it('localizes the handoff and explicit hand-back instructions in Bahasa Malaysia', async () => {
    const repo = new LocalRepository();
    await repo.setLang('bm');
    mount({ from: 'ai', state: 'done', runId: RUN, text: 'Sila log masuk.\n```jentera-browser\n{"reason":"sign_in"}\n```' }, repo, vi.fn());
    const card = await screen.findByRole('region', { name: 'Log masuk untuk meneruskan' });
    expect(within(card).getByRole('button', { name: 'Buka pelayar bisnes' })).toBeVisible();
    expect(card).toHaveTextContent('Serah kembali kepada Jentera');
    expect(card).toHaveTextContent('bukan dalam Chat');
  });
  it('does not offer an unusable viewer button when browser access is unavailable', async () => {
    const view = mount({ from: 'ai', state: 'done', runId: RUN, text: 'Please sign in.\n```jentera-browser\n{"reason":"sign_in"}\n```' });
    expect(await screen.findByText('Please sign in.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open business browser' })).toBeNull();
    expect(view.container.textContent).not.toContain('jentera-browser');
  });
  it.each([
    { state: 'failed' as const, failedQuestion: 'Open a site' },
    { runId: undefined },
    { from: 'you' as const },
    { state: 'working' as const },
  ])('does not offer handoff for a non-completed agent request: %j', async overrides => {
    mount({ from: 'ai', state: 'done', runId: RUN, text: '```jentera-browser\n{"reason":"sign_in"}\n```', ...overrides }, new LocalRepository(), vi.fn());
    await waitFor(() => expect(screen.getByRole('article', { name: 'Jentera' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Open business browser' })).toBeNull();
  });
  it.each(['done', 'streaming'] as const)('hides internal markers in %s replies', async state => {
    const view = mount({ from: 'ai', text: '@step: Susun ringkasan dan sumber\n\nSiap boss.', state,
      ...(state === 'streaming' ? { pendingId: 'p1' } : {}) });
    await screen.findByText('Siap boss.');
    expect(view.container.querySelector('.ask-reply-text')).toHaveTextContent('Siap boss.');
    expect(view.container.querySelector('.ask-reply-text')).not.toHaveTextContent('@step');
    expect(view.container.querySelector('.ask-reply-text')).not.toHaveTextContent('Susun ringkasan');
  });
  it('does not claim thinking when a no-step reply has been silent for minutes', async () => {
    const { container } = mount({ from: 'ai', text: '💭 Thinking…', state: 'working',
      pendingId: 'p1', startedAt: Date.now() - 195000, lastProgressAt: Date.now() - 195000 });
    expect(await screen.findByText(/No new progress update/)).toBeVisible();
    expect(screen.queryByText(/Thinking/)).toBeNull();
    expect(container.querySelector('.typing')).toBeNull();
    expect(container.querySelector('.ask-step-dot')).toBeNull();
    expect(container.querySelector('.bubble.bubble-in')).not.toBeNull();
  });
  it('shows status recovery instead of thinking after a disconnected stream', async () => {
    mount({ from: 'ai', text: 'Partial answer', liveStatus: '💭 Thinking…', state: 'streaming',
      pendingId: 'p1', startedAt: Date.now() - 195000, connectionStatus: 'Connection restored. Checking your task’s result…' });
    expect(await screen.findByText('Connection restored. Checking your task’s result…')).toBeVisible();
    expect(screen.getAllByText('Connection restored. Checking your task’s result…')).toHaveLength(1);
    expect(screen.queryByText(/Reconnecting/)).toBeNull();
    expect(screen.queryByText(/Thinking/)).toBeNull();
    expect(screen.getByText('Partial answer')).toBeVisible();
  });
  it('recovers referenced images from this chat and identifies missing deliveries', async () => {
    const repo = new LocalRepository();
    const file = { id: 'cat-file', runId: RUN, name: 'cute-cat.png', contentType: 'image/png', size: 10, createdAt: new Date().toISOString() };
    const list = vi.spyOn(repo, 'listArtifacts').mockResolvedValueOnce([]).mockResolvedValueOnce([file]);
    repo.fetchArtifact = async () => new Blob(['png'], { type: 'image/png' });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovered-cat');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const view = mount({ from: 'ai', text: 'Both attached: outputs/cute-cat.png and outputs/codex-cat.png', state: 'done', runId: RUN }, repo);
      expect(await screen.findByRole('img', { name: 'cute-cat.png' })).toHaveAttribute('src', 'blob:recovered-cat');
      expect(screen.getByText(/Some images weren’t attached: codex-cat.png/)).toBeVisible();
      expect(list).toHaveBeenCalledWith({ relatedRunId: RUN, limit: 200 });
      view.unmount();
    } finally { create.mockRestore(); revoke.mockRestore(); }
  });
  it('renders a completed model proposal as a prefilled confirmation card', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, err: 'Not found' }), { status: 404 }));
    try {
      const text = 'Please confirm.\n```jentera-reminder\n' + JSON.stringify({ message: 'Drink water', dueAt: '2027-01-01T01:03:35.000Z', timeZone: 'Asia/Kuala_Lumpur' }) + '\n```';
      const view = mount({ from: 'ai', text, state: 'done', runId: RUN });
      expect((await screen.findByLabelText('Date and time') as HTMLInputElement).value).toBe('2027-01-01T09:03');
      expect(screen.getByLabelText('Remind me to')).toHaveValue('Drink water');
      expect(view.container.textContent).not.toContain('jentera-reminder');
      expect(screen.getByText('Delivered to Notifications')).toBeInTheDocument();
      expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    } finally { fetch.mockRestore(); }
  });
  it('recovers a failed task’s image and displays it inline without opening a dialog', async () => {
    const file = { id: 'image-1', runId: RUN, name: 'result.png', contentType: 'image/png', size: 8, createdAt: '2026-09-12T01:00:00Z' };
    const repo = Object.assign(new LocalRepository(), {
      listArtifacts: vi.fn(async () => [file]),
      fetchArtifact: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const view = mount({ from: 'ai', text: 'Reply failed', state: 'failed', failedQuestion: 'Generate image', runId: RUN }, repo);
      expect(await screen.findByRole('img', { name: 'result.png' })).toHaveAttribute('src', 'blob:test-image');
      expect(repo.listArtifacts).toHaveBeenCalledWith({ runId: RUN });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent('Reply failed');
      view.unmount();
      expect(revoke).toHaveBeenCalledWith('blob:test-image');
    } finally { create.mockRestore(); revoke.mockRestore(); }
  });

  it('shows a plain reply for a quick answer the server called conversation', async () => {
    const { container } = mount({
      from: 'ai', text: 'Yes, Sunday too.', mode: 'work', runId: RUN, state: 'done',
      depth: 'quick', kind: 'conversation', taskTitle: 'are we open on sunday?',
    });
    await waitFor(() => expect(container.textContent).toContain('Yes, Sunday too.'));
    expect(container.querySelector('.chat-task-card')).toBeNull();
    expect(container.querySelector('.ask-reply-activity')).toBeNull();
  });

  it('offers Stop on a reply still running, and cancels the run', async () => {
    const cancelRun = vi.fn(async () => {});
    const repo = new LocalRepository();
    (repo as unknown as { cancelRun: (id: string) => Promise<void> }).cancelRun = cancelRun;
    const { container } = mount(
      { from: 'ai', text: 'Reading information', state: 'working', pendingId: 'p1', runId: RUN, kind: 'work' },
      repo,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(cancelRun).toHaveBeenCalledWith(RUN);
    expect(container.textContent).toContain('Stopping');
  });

  it('hides Stop where the runtime cannot be asked to stop', async () => {
    /* A Stop that does nothing is worse than none: the owner presses it, the
       timer keeps counting, and they learn the product lies. */
    mount({ from: 'ai', text: 'Reading information', state: 'working', pendingId: 'p1', runId: RUN, kind: 'work' });
    await waitFor(() => expect(screen.getByText('Reading information')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('reads as a reply, with work reachable from Activity rather than a card', async () => {
    const { container } = mount({
      from: 'ai', text: 'Sent the reminder.', mode: 'work', runId: RUN, state: 'done',
      depth: 'quick', kind: 'work', taskTitle: 'chase the late invoice',
    });
    await waitFor(() => expect(container.textContent).toContain('Sent the reminder.'));
    expect(container.querySelector('.chat-task-card')).toBeNull();
    /* The link the card used to carry is in the footer, where every other
       thing you can do with a reply already lives. */
    expect(screen.getByRole('button', { name: /activity/i })).toBeInTheDocument();
  });

  it('does not infer a task from deep mode while the agent is running', async () => {
    const { container } = mount({
      from: 'ai', text: 'Working…', mode: 'work', runId: RUN, state: 'working',
      pendingId: 'p1', depth: 'deep', taskTitle: 'compare suppliers',
    });
    await waitFor(() => expect(container.textContent).toContain('Working…'));
    expect(container.querySelector('.chat-task-card')).toBeNull();
  });

  it('keeps a completed deep explanation as chat', async () => {
    const { container } = mount({ from: 'ai', text: 'Explanation', mode: 'work', runId: RUN,
      state: 'done', depth: 'deep', kind: 'conversation' });
    await waitFor(() => expect(container.textContent).toContain('Explanation'));
    expect(container.querySelector('.chat-task-card')).toBeNull();
    expect(container.querySelector('.ask-reply-ready')).toBeNull();
  });

  it('does not call a reply awaiting authorization done', async () => {
    const { container } = mount({ from: 'ai', text: 'Authorize in your browser', mode: 'work', runId: RUN,
      state: 'done', kind: 'work', taskStatus: 'needs_input' });
    await waitFor(() => expect(container.textContent).toContain('Authorize in your browser'));
    /* The Ready badge is the claim that matters, and it stays off. What is
       outstanding is said in the reply, not in a status chip on a card. */
    expect(container.querySelector('.ask-reply-ready')).toBeNull();
    expect(container.querySelector('.chat-task-card')).toBeNull();
  });
});

describe('AskReply: the waiting bubble keeps moving', () => {
  /* Native Hermes shows something changing the whole time it works. Between
     two status lines nothing moved here for seconds, so the owner could not
     tell a slow reply from a dead one. */
  it('counts the seconds since the message was sent next to the status', async () => {
    const { container } = mount({
      from: 'ai', text: '💭 Thinking…', mode: 'work', state: 'working',
      pendingId: 'p2', depth: 'quick', startedAt: Date.now() - 3_000,
    });
    await waitFor(() => expect(container.textContent).toContain('💭 Thinking…'));
    await waitFor(() => expect(container.querySelector('.bubble')).toHaveTextContent(/· [34]s/));
    expect(container.querySelector('.typing')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('.bubble')).toHaveTextContent(/· [45]s/), { timeout: 3_000 });
  });

  it('shows what the agent is doing under answer text that has already started', async () => {
    const { container } = mount({
      from: 'ai', text: 'Let me check that for you.', mode: 'work', state: 'streaming',
      pendingId: 'p3', depth: 'quick', startedAt: Date.now() - 2_000,
      liveStatus: '🔎 web_search: KL weather now',
    });
    await waitFor(() => expect(container.textContent).toContain('Let me check that for you.'));
    expect(container.textContent).toContain('🔎 web_search: KL weather now');
    await waitFor(() => expect(container.querySelector('.bubble')).toHaveTextContent(/· [23]s/));
  });
});

describe('AskReply: the agent\'s steps', () => {
  it('keeps login values in older command traces hidden after restoring the list', async () => {
    const { container } = mount({ from: 'ai', text: 'Working', pendingId: 'p', state: 'working', steps: ['process: "submit proc_old private-login-value"'] });
    await waitFor(() => expect(document.querySelector('article [role="status"]')).toHaveTextContent('Checking task progress'));
    expect(container.textContent).not.toContain('private-login-value');
    expect(container.querySelector('.task-progress')).toBeNull();
  });
  /* "@step:" lines used to replace one label, and once leaked into the reply
     as text. They are the agent narrating its work, so they read as a list:
     done steps ticked, the current one moving, and the whole list kept as a
     small receipt under the finished answer. */
  it('lists the steps while working, with the latest one current', async () => {
    const { container } = mount({
      from: 'ai', text: '💭 Thinking…', mode: 'work', state: 'working', pendingId: 'p4', depth: 'quick',
      startedAt: Date.now() - 2_000,
      steps: ['Searching for today\'s headlines', '🌐 web_extract: "https://www.malaymail.com/"'],
    });
    await waitFor(() => expect(container.querySelector('.ask-steps')).not.toBeNull());
    const items = Array.from(container.querySelectorAll('.ask-steps li'));
    expect(items.map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Continuing the task'), expect.stringContaining('Reading information')]),
    );
    expect(container.querySelector('article [role="status"]')).toHaveTextContent('Reading information');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
  });

  it('keeps the steps as a collapsed receipt under the finished answer', async () => {
    const { container } = mount({
      from: 'ai', text: 'Top stories today: …', mode: 'work', runId: RUN, state: 'done',
      depth: 'quick', kind: 'work', taskTitle: 'news', steps: ['Searching', 'Reading Malay Mail', 'Summarising'],
    });
    await waitFor(() => expect(container.textContent).toContain('Top stories today'));
    const receipt = container.querySelector('details.ask-reply-steps');
    expect(receipt).not.toBeNull();
    expect(receipt?.querySelector('summary')?.textContent).toContain('3');
    /* Three narration lines are one kind of work; the count survives on the line. */
    const items = receipt?.querySelectorAll('li') ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('3');
  });

  it('names the programs behind a run of computer steps, once', async () => {
    const { container } = mount({
      from: 'ai', text: 'Working', mode: 'work', state: 'working', pendingId: 'p5', depth: 'quick',
      startedAt: Date.now() - 2_000,
      steps: ['💻 terminal: "git"', '💻 terminal: "git"', '💻 terminal: "python3"', '🔍 web_search: "oat milk latte PJ"'],
    });
    await waitFor(() => expect(container.querySelector('.ask-steps')).not.toBeNull());
    const items = Array.from(container.querySelectorAll('.ask-steps li')).map((li) => li.textContent ?? '');
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Running a command');
    expect(items[0]).toContain('git, python3');
    expect(items[0]).toContain('3');
    expect(items[1]).toContain('oat milk latte PJ');
  });

  it('groups long search details and timing below the step title', async () => {
    const query = 'Putrajaya news today 13 September 2026 berita terkini Putrajaya hari ini';
    const { container } = mount({
      from: 'ai', text: '', mode: 'work', state: 'working', pendingId: 'mobile-search', depth: 'quick',
      startedAt: Date.now() - 8_000,
      steps: [`🔍 web_search: "${query}"`, `🔍 web_search: "${query}"`],
    });
    await waitFor(() => expect(container.querySelector('.ask-step-content')).not.toBeNull());
    const content = container.querySelector('.ask-step-content')!;
    expect(content.querySelector('.ask-step-label')).toHaveTextContent('Searching for information');
    expect(container.querySelector('details .ask-step-subject')).toHaveTextContent(query);
    expect(container.querySelector('summary')).toHaveTextContent('View activity · 2');
    expect(content.querySelector('.ask-step-meta')).toHaveTextContent('8s');
  });
});

describe('AskReply: files the agent produced', () => {
  it('offers each file as a download, named and sized', async () => {
    const repo = new LocalRepository();
    repo.artifactUrl = (id: string) => `https://api.test/api/artifacts/${id}`;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RepositoryProvider repository={repo}>
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </RepositoryProvider>
    );
    const message: AskMessage = {
      from: 'ai', text: 'Your digest is attached.', state: 'done', runId: RUN, taskTitle: 'digest', mode: 'work', kind: 'conversation',
      artifacts: [
        { id: 'a1', runId: RUN, name: 'tech-digest.md', contentType: 'text/markdown', size: 5321, createdAt: '2026-09-12T01:00:00.000Z' },
        { id: 'a2', runId: RUN, name: 'sources.csv', contentType: 'text/csv', size: 640, createdAt: '2026-09-12T01:00:00.000Z' },
      ],
    };
    repo.fetchArtifact = async () => new Blob(['# Digest'], { type: 'text/markdown' });
    render(<AskReply message={message} onOpenActivity={() => {}} onRetry={() => {}} />, { wrapper });
    const list = await screen.findByRole('list', { name: 'Files' });
    const chips = within(list).getAllByRole('button');
    expect(chips.map((b) => b.textContent)).toEqual([expect.stringContaining('tech-digest.md'), expect.stringContaining('sources.csv')]);
    expect(chips[0]).toHaveTextContent('5.2 KB');
    expect(chips[1]).toHaveTextContent('640 B');
    const download = within(list).getByRole('link', { name: 'Download tech-digest.md' });
    expect(download).toHaveAttribute('href', 'https://api.test/api/artifacts/a1');
    expect(download).toHaveAttribute('download', 'tech-digest.md');

    /* Tapping a chip opens the file in place instead of downloading it. */
    const user = userEvent.setup();
    await user.click(chips[0]);
    const dialog = await screen.findByRole('dialog', { name: 'tech-digest.md' });
    expect(await within(dialog).findByRole('heading', { name: 'Digest' })).toBeInTheDocument();
  });
});
