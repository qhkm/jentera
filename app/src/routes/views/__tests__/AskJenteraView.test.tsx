import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import AskJenteraView from '@/routes/views/AskJenteraView';
import { AskReply } from '@/components/AskReply';
import { ToastProvider } from '@/components/Toast';
import { ActivityProvider } from '@/hooks/useActivity';
import { useBusiness } from '@/hooks/useBusiness';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import type { AskAnswer, AskOptions } from '@/lib/repo';
import type { BrowserCommand } from '@/lib/repo/types';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function Harness({ onOpenConnections, taskDraft }: {
  onOpenConnections?: () => void;
  taskDraft?: { text: string; key: number; sessionId?: string; goalId?: string; goalTitle?: string };
} = {}) {
  const { business } = useBusiness();
  return <AskJenteraView
    business={business}
    handled={0}
    needs={0}
    onOpenConnections={onOpenConnections}
    taskDraft={taskDraft}
  />;
}

async function mount(children: ReactNode = <Harness />, repo = new LocalRepository()) {
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  repo.activity = async () => ({
    counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 },
    work: [],
  });
  // Flush the async initial snapshot and Shell effects before a short test
  // can finish and remove its browser API stubs during cleanup.
  await act(async () => {
    render(
      <MemoryRouter>
      <SignedInProvider value account="ask-studio-test">
        <RepositoryProvider repository={repo}>
          <I18nProvider>
            <ToastProvider>
              <ActivityProvider>{children}</ActivityProvider>
            </ToastProvider>
          </I18nProvider>
        </RepositoryProvider>
      </SignedInProvider>
      </MemoryRouter>,
    );
  });
  return repo;
}

describe('compose-first Ask Jentera', () => {
  it('uses concise toolbar labels while preserving descriptive accessible names and tooltips', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.runtimeSkills = vi.fn(async () => [{ id: 'market-scan', name: 'Market scan', description: 'Compare sources.', category: 'Research', disabled: false }]);
    await mount(<Harness />, repo);
    const toolbar = within(document.querySelector('.ask-writing-tools') as HTMLElement);
    const attach = toolbar.getByRole('button', { name: 'Add photo or file' });
    expect(attach).toHaveTextContent('Attach');
    expect(attach).toHaveAttribute('title', 'Add photo or file');
    const skills = toolbar.getByRole('button', { name: 'Choose skills for this message' });
    expect(skills).toHaveTextContent('Skills');
    expect(skills).toHaveAttribute('title', 'Choose skills for this message');
    await user.click(skills);
    expect(await screen.findByRole('searchbox', { name: 'Search skills' })).toBeVisible();
    const browser = toolbar.getByRole('button', { name: 'Open business browser' });
    expect(browser).toHaveTextContent('Browser');
    expect(browser).not.toHaveTextContent('Business browser');
    expect(browser).toHaveAttribute('title', 'Open business browser');
  });
  it('searches VM skills and loads the selected skill for only the next message', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.runtimeSkills = vi.fn(async () => [
      { id: 'market-scan', name: 'Market scan', description: 'Compare public sources.', category: 'Research', disabled: false },
      { id: 'pdf', name: 'PDF', description: 'Work with PDF files.', category: 'Documents', disabled: false },
    ]);
    repo.ask = vi.fn(async () => ({ text: 'Done', usedKeys: [], grounded: false }));
    await mount(<Harness />, repo);

    await user.click(screen.getByRole('button', { name: 'Choose skills for this message' }));
    const search = await screen.findByRole('searchbox', { name: 'Search skills' });
    await user.type(search, 'market');
    expect(screen.getByText('Market scan')).toBeVisible();
    expect(screen.queryByText('Work with PDF files.')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /Market scan/ }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByLabelText('1 of 5 selected')).toBeVisible();

    await user.type(screen.getByRole('textbox'), 'Compare these suppliers');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(repo.ask).toHaveBeenCalledWith(
      'Compare these suppliers',
      expect.objectContaining({ selectedSkills: ['market-scan'] }),
    ));
    expect(screen.queryByLabelText('1 of 5 selected')).toBeNull();
  });
  it('shows the free-chat balance without changing the writing pad', async () => {
    vi.stubEnv('VITE_API_URL', 'https://fixture.invalid');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ signedIn: true, access: { kind: 'preview', preview: { limit: 10, used: 3, remaining: 7 } } })));
    await mount();
    expect(await screen.findByText('7 of 10 free chats left')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', '/subscribe');
  });
  it('blocks new input after ten chats but keeps the tenth response alive', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_API_URL', 'https://fixture.invalid');
    let used = 9;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ signedIn: true, access: { kind: 'preview', preview: { limit: 10, used, remaining: 10 - used } } })));
    let finish!: (answer: AskAnswer) => void;
    const repo = new LocalRepository();
    repo.ask = vi.fn(() => {
      used = 10; window.dispatchEvent(new Event('jentera:preview-change'));
      return new Promise<AskAnswer>(resolve => { finish = resolve; });
    });
    await mount(<Harness />, repo);
    await screen.findByText('1 of 10 free chats left');
    await user.type(screen.getByRole('textbox'), 'Are we open today?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('heading', { name: 'Your 10 free chats are complete.' })).toBeVisible();
    expect(repo.ask).toHaveBeenCalledWith('Are we open today?', expect.objectContaining({ mode: 'work' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Upgrade — RM99/ })).toHaveAttribute('href', '/subscribe');
    await act(async () => finish({ text: 'Yes, open until 6pm.', grounded: true, usedKeys: [] }));
    expect(await screen.findByText('Yes, open until 6pm.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your 10 free chats are complete.' })).toBeVisible();
    expect(repo.ask).toHaveBeenCalledTimes(1);
  });
  it('keeps the original chat draft and attachment when a continuation arrives from Activity', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi.fn();
    localStorage.setItem('jentera-ask-sessions-v1:ask-studio-test', JSON.stringify([{ id: 'original-chat', title: 'Earlier task',
      createdAt: 1, updatedAt: 2, messages: [{ from: 'you', text: 'My original request' }, { from: 'ai', text: 'Waiting for details' }] }]));
    function ReturningFromActivity() {
      const [taskDraft, setTaskDraft] = useState<NonNullable<Parameters<typeof Harness>[0]>['taskDraft']>();
      return <><button onClick={() => setTaskDraft({ key: 1, sessionId: 'original-chat', text: 'Continue my earlier request: Earlier task' })}>
        Return with task context
      </button><Harness taskDraft={taskDraft} /></>;
    }
    await mount(<ReturningFromActivity />, repo);
    await user.type(await screen.findByRole('textbox'), 'Keep my draft');
    await user.upload(screen.getByLabelText('Choose a file for Jentera'), new File(['notes'], 'notes.txt', { type: 'text/plain' }));
    await user.click(screen.getByRole('button', { name: 'Return with task context' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Continue my earlier request: Earlier task\n\nKeep my draft'));
    expect(screen.getByText('notes.txt')).toBeVisible();
    expect(screen.getByText('My original request', { selector: '.ask-owner-message p' })).toBeVisible();
    expect(repo.ask).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('jentera-ask-sessions-v1:ask-studio-test') ?? '[]')).toHaveLength(1);
  });
  it('prepares a verified-setup continuation in the same chat without sending or losing a draft or attachment', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    const text = 'The site needs sign-in.\n```jentera-browser\n{"reason":"sign_in"}\n```';
    let originalSession = '';
    repo.ask = vi.fn(async (_question: string, options?: AskOptions) => {
      originalSession = options?.sessionId ?? '';
      return { text, runId, taskStatus: 'needs_input', grounded: false, usedKeys: [] };
    });
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', taskStatus: 'needs_input', pending: false,
      text, sessionId: originalSession }));
    repo.businessBrowser = vi.fn(async () => ({ enabled: true, paused: false }));
    await mount(<Harness />, repo);
    await user.type(await screen.findByRole('textbox'), 'Check my browser session');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const card = await screen.findByRole('region', { name: 'Sign in to continue' });
    await user.type(screen.getByRole('textbox'), 'My follow-up draft');
    const file = new File(['context'], 'notes.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('Choose a file for Jentera'), file);
    await user.click(within(card).getByRole('button', { name: 'Check setup' }));
    expect(repo.ask).toHaveBeenCalledOnce();
    await user.click(await within(card).findByRole('button', { name: 'Continue in Chat' }));
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Continue my earlier request: Check my browser session'));
    const draft = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
    expect(draft).toContain('My follow-up draft');
    expect(draft).toContain('First verify');
    expect(draft).not.toContain('jentera-browser');
    expect(screen.getByText('notes.txt')).toBeVisible();
    expect(repo.ask).toHaveBeenCalledOnce();
    await user.click(within(card).getByRole('button', { name: 'Continue in Chat' }));
    await waitFor(() => expect(repo.runResult).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('textbox')).toHaveValue(draft);
    expect(JSON.parse(localStorage.getItem('jentera-ask-sessions-v1:ask-studio-test') ?? '[]')).toHaveLength(1);
    expect(screen.getByText('Check my browser session', { selector: '.ask-owner-message p' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(repo.ask).toHaveBeenCalledTimes(2));
    expect(vi.mocked(repo.ask).mock.calls[1][1]).toMatchObject({ sessionId: originalSession, attachment: file });
  });
  it('says it could not check rather than claiming Jentera is paused', async () => {
    /* The refresh fires on activation, focus and visibility only — never on a
       timer, because a status request wakes a sleeping business computer. So a
       failure on a phone's flaky connection used to render as "paused", and
       sending is blocked while paused, so the one thing that could clear it
       could not run. The panel must not assert a state it did not verify. */
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.businessBrowser = vi.fn(async () => { throw new Error('offline'); });
    await mount(<Harness />, repo);

    expect(await screen.findByText(/could not check/i)).toBeVisible();
    expect(screen.queryByText(/still under owner control/i)).not.toBeInTheDocument();

    vi.mocked(repo.businessBrowser).mockResolvedValue({ enabled: true, paused: false });
    await user.click(screen.getByRole('button', { name: /check again/i }));

    await waitFor(() => expect(screen.queryByText(/could not check/i)).not.toBeInTheDocument());
  });

  it('still names owner control when the browser really is paused', async () => {
    const repo = new LocalRepository();
    repo.businessBrowser = vi.fn(async () => ({ enabled: true, paused: true }));
    await mount(<Harness />, repo);

    expect(await screen.findByText(/still under owner control/i)).toBeVisible();
    /* The chat tool offers the same action, so more than one button carries
       this name; the panel having one is what matters. */
    expect(screen.getAllByRole('button', { name: /open business browser/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/could not check/i)).not.toBeInTheDocument();
  });

  it('retains a setup card and its original request after a refresh without automatically checking or resending', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    localStorage.setItem('jentera-ask-sessions-v1:ask-studio-test', JSON.stringify([{ id: 'original-chat', title: 'Calendar task',
      createdAt: 1, updatedAt: 2, messages: [{ from: 'you', text: 'Check my calendar access' },
        { from: 'ai', state: 'done', runId, text: 'Connect first.\n```jentera-connect\n{"connector":"google_calendar"}\n```' }] }]));
    repo.ask = vi.fn();
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, taskStatus: 'needs_input',
      sessionId: 'original-chat', text: 'Connect first.\n```jentera-connect\n{"connector":"google_calendar"}\n```' }));
    repo.connections = vi.fn(async () => [{ id: 'google', connector: 'google', method: 'oauth', status: 'connected' as const,
      displayName: null, externalId: null, connectedAt: '', lastOkAt: null, lastError: null }]);
    repo.businessBrowser = vi.fn(async () => ({ enabled: true, paused: false }));
    await mount(<Harness />, repo);
    const card = await screen.findByRole('region', { name: 'Connect your calendar' });
    expect(repo.ask).not.toHaveBeenCalled();
    expect(repo.runResult).not.toHaveBeenCalled();
    expect(repo.connections).not.toHaveBeenCalled();
    await user.click(within(card).getByRole('button', { name: 'Check setup' }));
    await user.click(await within(card).findByRole('button', { name: 'Continue in Chat' }));
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Continue my earlier request: Check my calendar access'));
    expect(repo.ask).not.toHaveBeenCalled();
  });
  it('keeps the linked goal visible while the owner works in Chat', async () => {
    await mount(<Harness taskDraft={{
      key: 1,
      text: 'Plan the next sales campaign',
      goalId: '11111111-1111-4111-8111-111111111111',
      goalTitle: 'Reach 100 monthly orders',
    }} />);
    expect(await screen.findByText('Reach 100 monthly orders')).toBeVisible();
    expect(screen.getByTitle('Reach 100 monthly orders')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('Plan the next sales campaign');
  });

  it('attaches an Excel file to a question and can send the file on its own', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi.fn().mockResolvedValue({ text: 'The totals do not match.', grounded: false, usedKeys: [] });
    await mount(<Harness />, repo);
    const file = new File(['workbook'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await user.upload(await screen.findByLabelText('Choose a file for Jentera'), file);
    expect(screen.getByText('sales.xlsx')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace file' })).toBeVisible();
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeEnabled();
    await user.click(send);

    await waitFor(() => expect(repo.ask).toHaveBeenCalledWith(
      'Review this file and tell me what stands out.',
      expect.objectContaining({ attachment: file, mode: 'work' }),
    ));
    expect(vi.mocked(repo.ask).mock.calls[0]?.[1]).not.toHaveProperty('responseMode');
    expect(screen.getByText('sales.xlsx')).toBeVisible();
  });
  it('routes the request automatically instead of asking the user to choose an answer mode', async () => {
    await mount();
    expect(await screen.findByRole('textbox')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Answer mode' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Research' })).toBeNull();
  });
  it('opens browser control from the composer without navigating away or losing the draft', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const browser = vi.fn(async (_command?: BrowserCommand) => ({ enabled: true, paused: false }));
    repo.businessBrowser = browser;
    const openConnections = vi.fn();
    await mount(<Harness onOpenConnections={openConnections} />, repo);
    await user.type(await screen.findByRole('textbox'), 'Review my business account');
    await user.click(screen.getByRole('button', { name: 'Open business browser' }));
    expect(await screen.findByRole('heading', { name: 'Business browser' })).toBeVisible();
    expect(screen.getByRole('dialog').closest('form')).toBeNull();
    await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'claim')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Close browser view' }));
    await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(true));
    expect(screen.getByRole('textbox')).toHaveValue('Review my business account');
    expect(openConnections).not.toHaveBeenCalled();
  });
  it('opens the same browser from an agent handoff card without sending or losing a draft', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const browser = vi.fn(async (_command?: BrowserCommand) => ({ enabled: true, paused: false }));
    repo.businessBrowser = browser;
    repo.ask = vi.fn().mockResolvedValue({ text: 'The site needs sign-in.\n```jentera-browser\n{"reason":"sign_in"}\n```',
      runId: '11111111-1111-4111-8111-111111111111', grounded: false, usedKeys: [] });
    const openConnections = vi.fn();
    await mount(<Harness onOpenConnections={openConnections} />, repo);
    await user.type(await screen.findByRole('textbox'), 'Check my browser session');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const card = await screen.findByRole('region', { name: 'Sign in to continue' });
    await user.type(screen.getByRole('textbox'), 'My follow-up draft');
    await user.click(within(card).getByRole('button', { name: 'Open business browser' }));
    expect(await screen.findByRole('heading', { name: 'Business browser' })).toBeVisible();
    await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'claim')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Close browser view' }));
    await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(true));
    expect(screen.getByRole('textbox')).toHaveValue('My follow-up draft');
    expect(repo.ask).toHaveBeenCalledOnce();
    expect(openConnections).not.toHaveBeenCalled();
    await user.click(within(document.querySelector('.ask-writing-pad') as HTMLElement).getByRole('button', { name: 'Open business browser' }));
    expect(await screen.findByRole('heading', { name: 'Business browser' })).toBeVisible();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await waitFor(() => expect(browser.mock.calls.filter(([command]) => command?.action === 'claim')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Close browser view' }));
    await waitFor(() => expect(browser.mock.calls.filter(([command]) => command?.action === 'release')).toHaveLength(2));
  });
  it('keeps the browser dialog mounted during takeover and never submits chat from browser forms', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    let paused = false;
    repo.businessBrowser = vi.fn(async (command?: BrowserCommand) => {
      if (command?.action === 'claim') paused = true;
      if (command?.action === 'release') paused = false;
      return { enabled: true, paused, ...(command?.action === 'frame' ? { image: 'aW1hZ2U=', tabs: [] } : {}) };
    });
    repo.ask = vi.fn();
    await mount(<Harness />, repo);
    await user.type(await screen.findByRole('textbox'), 'Continue after I sign in');
    await user.click(screen.getByRole('button', { name: 'Open business browser' }));
    expect(await screen.findByText('Jentera is paused')).toBeVisible();
    await user.type(screen.getByLabelText('Website address'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(repo.ask).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close browser view' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
    expect(repo.businessBrowser).toHaveBeenCalledWith(expect.objectContaining({ action: 'release' }));
    expect(screen.getByRole('textbox')).toHaveValue('Continue after I sign in');
  });
  it('explains owner browser control, blocks sending, and opens the hand-back control inline', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    let paused = true;
    repo.businessBrowser = vi.fn(async (command?: BrowserCommand) => {
      if (command?.action === 'release') paused = false;
      return { enabled: true, paused };
    });
    repo.ask = vi.fn().mockResolvedValue({ text: 'Should not send.', grounded: false, usedKeys: [] });
    await mount(<Harness />, repo);

    expect(await screen.findByText('Jentera is paused')).toBeVisible();
    expect(screen.getByText(/Business Browser is still under owner control/)).toBeVisible();
    const input = screen.getByRole('textbox');
    await user.type(input, 'Prepare a reply');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(repo.ask).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open Business Browser' }));
    expect(await screen.findByRole('heading', { name: 'Business browser' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hand back to Jentera' }));
    await waitFor(() => expect(screen.queryByText('Jentera is paused')).toBeNull());
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });
  it('shows an accuracy disclaimer associated with the composer', async () => {
    await mount();
    const input = await screen.findByRole('textbox');
    const disclaimer = screen.getByText('Jentera can make mistakes. Verify important information before acting.');
    expect(disclaimer).toBeVisible();
    expect(disclaimer.closest('p')).toHaveClass('ask-ai-disclaimer');
    expect(input).toHaveAttribute('aria-describedby', disclaimer.closest('p')!.id);
  });
  it('shows the disclaimer in Bahasa Malaysia', async () => {
    const repo = new LocalRepository();
    await repo.setLang('bm');
    await mount(<Harness />, repo);
    expect(await screen.findByText('Jentera boleh tersilap. Semak maklumat penting sebelum bertindak.')).toBeVisible();
  });
  it('prepares a task without sending and keeps drafts with their own chats', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi.fn();
    await mount(<Harness />, repo);
    const starters = await screen.findByRole('group', { name: 'Start with a task' });
    await user.click(within(starters).getByRole('button', { name: 'Draft a reply' }));
    const input = screen.getByRole('textbox');
    const draft = (input as HTMLTextAreaElement).value;
    expect(draft).toContain('customer');
    expect(repo.ask).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(input).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Past chats' }));
    await user.click(screen.getAllByRole('button', { name: 'Open chat: New chat' }).at(-1)!);
    expect(input).toHaveValue(draft);
  });

  it('accepts another message while earlier work is still pending', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const finishes: Array<(answer: AskAnswer) => void> = [];
    repo.ask = vi.fn(
      () =>
        new Promise<AskAnswer>((resolve) => {
          finishes.push(resolve);
        }),
    );
    await mount(<Harness />, repo);
    const input = await screen.findByRole('textbox');
    await user.type(input, 'Prepare a reply');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(repo.ask).toHaveBeenCalledOnce());
    expect(screen.getByText('Jentera can make mistakes. Verify important information before acting.')).toBeVisible();
    await user.type(input, 'Make it suitable for a quotation');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(repo.ask).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue('');
    await act(async () =>
      finishes[0]({
        text: 'Here is the draft.\n\nPlease review the delivery date.',
        grounded: false,
        usedKeys: [],
      }),
    );
    expect(await screen.findByRole('button', { name: 'Copy reply' })).toBeInTheDocument();
    await act(async () =>
      finishes[1]({
        text: 'I made it suitable for a quotation.',
        grounded: false,
        usedKeys: [],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Make it shorter' }));
    expect(input).toHaveValue('Make your last answer shorter, keeping the important details.');
  });

  it('uses Enter for line breaks and submits only with Cmd/Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi.fn().mockResolvedValue({ text: 'Done.', grounded: false, usedKeys: [] });
    await mount(<Harness />, repo);
    const input = await screen.findByRole('textbox');
    await user.type(input, 'First line{Enter}Second line');
    expect(input).toHaveValue('First line\nSecond line');
    expect(repo.ask).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(repo.ask).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(repo.ask).toHaveBeenCalledWith('你好', expect.objectContaining({ mode: 'work' }));
  });

  it('retries the failed question and keeps the work mode', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce({ text: 'Draft prepared.', grounded: false, usedKeys: [] });
    await mount(<Harness />, repo);
    await user.type(await screen.findByRole('textbox'), 'Prepare a reply');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Try this again' }));
    expect(await screen.findByText('Draft prepared.')).toBeInTheDocument();
    expect(repo.ask).toHaveBeenLastCalledWith(
      'Prepare a reply',
      expect.objectContaining({ mode: 'work' }),
    );
  });
});

describe('usable replies', () => {
  it('copies the complete plain-text answer, preserving line breaks and treating HTML as text', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const text = 'First paragraph.\n\n<script>alert(1)</script>\n- One item';
    await mount(<AskReply message={{ from: 'ai', text, state: 'done' }} onRetry={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Copy reply' }));
    expect(copy).toHaveBeenCalledWith(text);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('reports a clipboard failure without pretending it copied', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
    await mount(<AskReply message={{ from: 'ai', text: 'Reply text' }} onRetry={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Copy reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy');
    expect(screen.getByRole('button', { name: 'Copy reply' })).toBeInTheDocument();
  });
});
