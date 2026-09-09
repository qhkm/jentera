import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { ReactNode } from 'react';
import { ConversationList } from '@/components/ChatWorkspace';
import { WorkspaceModeSwitch } from '@/components/WorkspaceModeSwitch';
import { ToastProvider } from '@/components/Toast';
import Dashboard from '@/routes/Dashboard';
import { ActivityProvider } from '@/hooks/useActivity';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import type { AskSession } from '@/hooks/useAsk';
import type { AskAnswer } from '@/lib/repo';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

async function mount(children: ReactNode, repo = new LocalRepository(), entry = '/app') {
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  repo.activity = async () => ({ counters: { handled: 0, needsYou: 2, minutesSaved: 0, thisWeek: 0, connections: 0 }, work: [] });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SignedInProvider value account="workspace-modes-test">
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
}

const sessions: AskSession[] = [
  { id: 'older', title: 'Supplier notes', createdAt: 100, updatedAt: 100, messages: [{ from: 'ai', text: 'Kopi beans arrive Monday.' }] },
  { id: 'newer', title: 'Catering quotation', createdAt: 200, updatedAt: 200, messages: [{ from: 'you', text: 'Prepare a quote.' }, { from: 'ai', text: '', pendingId: 'pending' }] },
];

describe('workspace navigation', () => {
  it('exposes the selected mode and only shows a real attention count', async () => {
    const change = vi.fn();
    await mount(<WorkspaceModeSwitch mode="chat" onChange={change} needsAttention={2} />);
    const modes = await screen.findByRole('navigation', { name: 'Workspace mode' });
    expect(within(modes).getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    expect(change).toHaveBeenCalledWith('dashboard');
    expect(screen.getByLabelText('2 waiting for your review')).toBeInTheDocument();
  });

  it('keeps drafts and the last business tab when switching modes and using browser Back', async () => {
    function Location() {
      const { search } = useLocation();
      const navigate = useNavigate();
      return <><output data-testid="location">{search}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
    }
    const user = userEvent.setup();
    await mount(<><Dashboard /><Location /></>, undefined, '/app?view=business&tab=handles');
    const modes = await screen.findByRole('navigation', { name: 'Workspace mode' });
    await user.click(within(modes).getByRole('button', { name: 'Chat' }));
    const composer = screen.getByRole('textbox');
    await user.type(composer, 'Notes for our quotation');
    await user.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('view=business&tab=handles');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByRole('textbox')).toBe(composer);
    expect(composer).toHaveValue('Notes for our quotation');
    expect(document.querySelector('.dashboard-sidebar')).toBeNull();
    expect(document.querySelector('.dashboard-bottom-nav')).toBeNull();
  });

  it('finishes a pending reply while Dashboard is open without making another request', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    let finish!: (answer: AskAnswer) => void;
    repo.ask = vi.fn(() => new Promise<AskAnswer>((resolve) => { finish = resolve; }));
    await mount(<Dashboard />, repo, '/app?view=chat');
    await user.type(await screen.findByRole('textbox'), 'Prepare a customer reply');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(repo.ask).toHaveBeenCalledOnce());
    const modes = screen.getByRole('navigation', { name: 'Workspace mode' });
    await user.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    await act(async () => finish({ text: 'Your draft is ready.', grounded: false, usedKeys: [] }));
    await user.click(within(modes).getByRole('button', { name: 'Chat' }));
    expect(document.querySelector('.ask-reply-text')).toHaveTextContent('Your draft is ready.');
    expect(repo.ask).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('opens the exact task from Chat and preserves that task and the draft across mode switches', async () => {
    function Location() {
      const { search } = useLocation();
      const navigate = useNavigate();
      return <><output data-testid="location">{search}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
    }
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    repo.ask = vi.fn(async () => ({ runId, text: 'Your quotation is ready.', grounded: false, usedKeys: [] }));
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, text: 'Full quotation, not sent.' }));
    await mount(<><Dashboard /><Location /></>, repo, '/app?view=chat');
    await user.type(await screen.findByRole('textbox'), 'Prepare a quotation');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const task = await screen.findByRole('button', { name: /Jentera task.*View task/ });
    await user.type(screen.getByRole('textbox'), 'Draft for later');
    await user.click(task);
    expect(await screen.findByText('Full quotation, not sent.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`view=work&run=${runId}`);
    expect(screen.getByTestId('location')).not.toHaveTextContent('quotation');
    const modes = screen.getByRole('navigation', { name: 'Workspace mode' });
    await user.click(within(modes).getByRole('button', { name: 'Chat' }));
    expect(screen.getByRole('textbox')).toHaveValue('Draft for later');
    await user.click(within(modes).getByRole('button', { name: /Dashboard/ }));
    expect(await screen.findByText('Full quotation, not sent.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`view=work&run=${runId}`);
    await user.click(screen.getByRole('button', { name: 'All activity' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('run=');
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(await screen.findByText('Full quotation, not sent.')).toBeInTheDocument();
    expect(repo.ask).toHaveBeenCalledOnce();
  });

  it('keeps older replies without run IDs linked to general Activity', async () => {
    const repo = new LocalRepository();
    localStorage.setItem('jentera-ask-sessions-v1:workspace-modes-test', JSON.stringify([{
      id: 'old-chat', title: 'Older work', createdAt: 1, updatedAt: 1,
      messages: [{ from: 'ai', text: 'An older reply', state: 'done', mode: 'work' }],
    }]));
    repo.runResult = vi.fn();
    await mount(<Dashboard />, repo, '/app?view=chat');
    await userEvent.click(await screen.findByRole('button', { name: 'View in Activity' }));
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(repo.runResult).not.toHaveBeenCalled();
  });

  it('offers status checking instead of resending an accepted task when its reply is interrupted', async () => {
    const repo = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    repo.ask = vi.fn(async (_question, options) => {
      options?.onRunCreated?.(runId);
      throw new Error('Connection lost');
    });
    repo.runResult = vi.fn(async () => ({ runId, status: 'completed', pending: false, text: 'The task did finish.' }));
    const user = userEvent.setup();
    await mount(<Dashboard />, repo, '/app?view=chat');
    await user.type(await screen.findByRole('textbox'), 'Prepare a quotation');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Check this task before sending it again. It may still be running.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Check task status/ }));
    expect(await screen.findByText('The task did finish.')).toBeInTheDocument();
    expect(repo.ask).toHaveBeenCalledOnce();
  });
});

describe('conversation sidebar', () => {
  it('sorts recent chats and searches both titles and message text without changing the active chat', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    await mount(<ConversationList sessions={sessions} activeId="newer" businessName="Kedai Kita" onOpen={open} onNew={vi.fn()} onDelete={vi.fn()} />);
    const search = await screen.findByRole('searchbox', { name: 'Search chats' });
    expect(screen.getAllByRole('button', { name: /Open chat:/ })[0]).toHaveAccessibleName('Open chat: Catering quotation');
    await user.type(search, 'KOPI BEANS');
    expect(screen.getAllByRole('button', { name: /Open chat:/ })).toHaveLength(1);
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Open chat: Supplier notes' }));
    expect(open).toHaveBeenCalledWith('older');
    await user.clear(search);
    await user.type(search, 'no matches');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(screen.getAllByRole('button', { name: /Open chat:/ })).toHaveLength(2);
  });

  it('requires confirmation to delete and protects chats with a pending reply', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    await mount(<ConversationList sessions={sessions} activeId="newer" businessName="Kedai Kita" onOpen={vi.fn()} onNew={vi.fn()} onDelete={remove} />);
    expect(await screen.findByRole('button', { name: 'Delete chat: Catering quotation' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Delete chat: Supplier notes' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete chat: Supplier notes' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('older');
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveFocus();
  });
});
