import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/AccountMenu';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ChatHistory } from '@/components/ChatHistory';
import { ToastProvider } from '@/components/Toast';
import { DetailLevelProvider } from '@/hooks/useDetailLevel';
import { ActivityProvider } from '@/hooks/useActivity';
import { useBusiness } from '@/hooks/useBusiness';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import type { Activity } from '@/lib/repo';
import type { AskSession } from '@/hooks/useAsk';
import MyBusinessView from '@/routes/views/MyBusinessView';
import ActivityView from '@/routes/views/ActivityView';
import { KEYS } from '@/lib/storage';

function mount(children: ReactNode, { repo = new LocalRepository(), signedIn = true } = {}) {
  return render(
    <SignedInProvider value={signedIn}>
      <RepositoryProvider repository={repo}>
        <I18nProvider>
          <ToastProvider>
            <DetailLevelProvider>{children}</DetailLevelProvider>
          </ToastProvider>
        </I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('account menu', () => {
  it('supports arrow navigation, Escape and outside dismissal', async () => {
    const user = userEvent.setup();
    mount(
      <>
        <AccountMenu onSignOut={vi.fn()} />
        <button>Outside</button>
      </>,
    );
    const trigger = await screen.findByRole('button', { name: 'Account menu' });
    trigger.focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: /switch to light/i })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /switch to Bahasa/i })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('persists appearance, language and detail choices through their existing repositories', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.detailLevel = async () => 'beginner';
    repo.setDetailLevel = vi.fn(async () => {});
    mount(<AccountMenu onSignOut={vi.fn()} />, { repo });
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: /switch to light/i }));
    await waitFor(() => expect(document.documentElement).toHaveClass('theme-light'));
    expect((await repo.load()).theme).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: /detail/i }));
    expect(repo.setDetailLevel).toHaveBeenCalledWith('advanced');
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: /switch to Bahasa/i }));
    await screen.findByRole('button', { name: 'Menu akaun' });
    expect((await repo.load()).lang).toBe('bm');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps demo preferences without offering account-only actions', async () => {
    mount(<AccountMenu onSignOut={vi.fn()} />, { signedIn: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Workspace preferences' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.queryByRole('menuitem', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('only signs out when the owner chooses Log out', async () => {
    const signOut = vi.fn();
    mount(<AccountMenu onSignOut={signOut} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(signOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});

const work: Activity['work'] = [
  'completed',
  'needs_approval',
  'running',
  'failed',
  'blocked',
  'cancelled',
].map((status, index) => ({
  id: status,
  runId: null,
  objective: `Task ${status}`,
  outcome: status === 'completed' ? 'Lunch order notes organised' : null,
  status,
  function: null,
  channel: index === 0 ? 'telegram' : 'web',
  subject: null,
  minutesSaved: null,
  outcomeQuality: null,
  qualityAt: null,
  occurredAt: `2026-09-0${index + 1}T10:00:00Z`,
}));

describe('real work history', () => {
  it('combines search with status filters, without treating declined work as still running', async () => {
    const user = userEvent.setup();
    mount(<ActivityHistory work={work}>{(record) => <p>{record.objective}</p>}</ActivityHistory>);
    const filters = await screen.findByRole('group', { name: 'Filter work history' });
    await user.click(within(filters).getByRole('button', { name: /in progress/i }));
    expect(screen.getByText('Task running')).toBeInTheDocument();
    expect(screen.queryByText('Task cancelled')).not.toBeInTheDocument();
    await user.click(within(filters).getByRole('button', { name: /completed/i }));
    await user.type(screen.getByRole('searchbox'), 'LUNCH');
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'telegram');
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'missing');
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all work' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    for (const record of work) expect(screen.getByText(record.objective)).toBeInTheDocument();
  });

  it('keeps failed and blocked work together, separate from the approval queue', async () => {
    mount(<ActivityHistory work={work}>{(record) => <p>{record.objective}</p>}</ActivityHistory>);
    const filters = await screen.findByRole('group', { name: 'Filter work history' });
    await userEvent.click(within(filters).getByRole('button', { name: /needs attention/i }));
    expect(screen.getByText('Task failed')).toBeInTheDocument();
    expect(screen.getByText('Task blocked')).toBeInTheDocument();
    expect(screen.queryByText('Task needs_approval')).not.toBeInTheDocument();
  });

  it('never filters pending approval actions out of the Activity page', async () => {
    const repo = new LocalRepository();
    repo.activity = async () => ({
      work,
      counters: { handled: 1, needsYou: 1, minutesSaved: 0, thisWeek: 1, connections: 1 },
    });
    localStorage.setItem(KEYS.bizType, 'restaurant');
    localStorage.setItem(
      KEYS.approvals,
      JSON.stringify([
        {
          id: 'approval',
          conn: 'telegram',
          op: 'send_message',
          risk: 'medium',
          status: 'pending',
          ts: Date.now(),
          args: { from: 'Aina', draft: 'Your lunch order is ready.' },
        },
      ]),
    );
    function Harness() {
      return <ActivityView b={useBusiness()} />;
    }
    mount(
      <ActivityProvider>
        <Harness />
      </ActivityProvider>,
      { repo },
    );
    await userEvent.type(await screen.findByRole('searchbox'), 'no such task');
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Don’t send' })).toBeInTheDocument();
  });

  it('offers a useful next step for a genuinely empty history', async () => {
    const open = vi.fn();
    mount(
      <ActivityHistory work={[]} onOpenAsk={open}>
        {(record) => <p>{record.objective}</p>}
      </ActivityHistory>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ask Jentera' }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('past chats', () => {
  const sessions: AskSession[] = ['Lunch order', 'Staff rota'].map((title, index) => ({
    id: String(index),
    title,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }));

  it('opens the selected conversation and returns focus to the trigger', async () => {
    const open = vi.fn();
    mount(<ChatHistory sessions={sessions} activeId="0" onOpen={open} onDelete={vi.fn()} />);
    const trigger = await screen.findByRole('button', { name: 'Past chats' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Open chat: Staff rota' }));
    expect(open).toHaveBeenCalledWith('1');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('requires confirmation before deleting a conversation', async () => {
    const remove = vi.fn();
    mount(<ChatHistory sessions={sessions} activeId="0" onOpen={vi.fn()} onDelete={remove} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Past chats' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Staff rota' }));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete chat: Staff rota' }));
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(remove).toHaveBeenCalledWith('1');
  });
});

describe('business profile', () => {
  function Harness() {
    return (
      <MyBusinessView
        b={useBusiness()}
        connections={{
          mode: 'real',
          real: true,
          rows: [],
          error: null,
          retry: vi.fn(),
          setRows: vi.fn(),
        }}
      />
    );
  }

  it('prevents empty names and cancels edits without submitting them', async () => {
    const repo = new LocalRepository();
    await repo.setBizType('restaurant');
    await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
    const save = vi.spyOn(repo, 'setBizProfile');
    mount(<Harness />, { repo });
    const name = await screen.findByRole('textbox', { name: 'Business name' });
    expect(screen.queryByText('yourbusiness.com')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Sheets · POS')).not.toBeInTheDocument();
    await userEvent.clear(name);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(name).toHaveValue('Kedai Kita');
    expect(save).not.toHaveBeenCalled();
    await userEvent.clear(name);
    await userEvent.type(name, '  Kedai Baru  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ name: 'Kedai Baru', loc: 'Shah Alam' }),
    );
    expect(name).toHaveValue('Kedai Baru');
  });

  it('supports keyboard tabs and preserves a draft while navigating business settings', async () => {
    const repo = new LocalRepository();
    await repo.setBizType('restaurant');
    mount(<Harness />, { repo });
    const name = await screen.findByRole('textbox', { name: 'Business name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Unsaved shop name');
    const profile = screen.getByRole('tab', { name: 'Profile' });
    profile.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')[1]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(profile).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Business name' })).toHaveValue('Unsaved shop name');
  });
});
