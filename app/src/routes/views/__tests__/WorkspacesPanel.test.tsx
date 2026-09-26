import { render, screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspacesPanel from '@/routes/views/WorkspacesPanel';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import type { Repository, TeamMember, Workspace, Workspaces } from '@/lib/repo';
import { useSharedChats } from '@/hooks/useSharedChats';
import { createTestQueryClient, renderWithQuery, returnToApp, TestQueryScope } from '@/test-support/query';

const MEMBERS: TeamMember[] = [
  { userId: 'u1', email: 'owner@example.com', role: 'owner', joinedAt: '2026-09-01T00:00:00.000Z', you: true },
  { userId: 'u2', email: 'aisha@example.com', role: 'staff', joinedAt: '2026-09-10T00:00:00.000Z', you: false },
  { userId: 'u3', email: 'ravi@example.com', role: 'staff', joinedAt: '2026-09-11T00:00:00.000Z', you: false },
];
const MARKETING: Workspace = {
  id: 'w1', name: 'Marketing', createdAt: '2026-09-12T00:00:00.000Z', member: true,
  members: [{ userId: 'u1', email: 'owner@example.com', you: true }, { userId: 'u2', email: 'aisha@example.com', you: false }],
};

function mount(data: Workspaces, over: Partial<Pick<Repository, 'createWorkspace' | 'addWorkspaceMember' | 'removeWorkspaceMember'>> = {}) {
  const repo = Object.assign(new LocalRepository(), { workspaces: vi.fn(async () => data) }, over) as Repository;
  render(
    <TestQueryScope><SignedInProvider value account="owner" teamVersion={1}>
      <RepositoryProvider repository={repo}>
        <I18nProvider><ToastProvider><WorkspacesPanel members={MEMBERS} /></ToastProvider></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider></TestQueryScope>,
  );
  return repo;
}

/** The chat screen's shared chats, as a line of text. */
function SharedChats() {
  const { workspaces } = useSharedChats(true);
  return <output data-testid="shared">{workspaces.map((w) => w.name).join(', ') || 'none'}</output>;
}

/** The Team panel and, with `chat`, the chat screen's shared chats, in one signed-in cache. */
async function page(repo: Repository, { chat = true, client }: { chat?: boolean; client?: QueryClient } = {}) {
  return renderWithQuery(<SignedInProvider value account="owner" teamVersion={1}><ToastProvider>
    {chat && <SharedChats />}
    <WorkspacesPanel members={MEMBERS} />
  </ToastProvider></SignedInProvider>, { repository: repo, client });
}

function teamRepo(first: Workspaces) {
  let data = first;
  const repo = Object.assign(new LocalRepository(), {
    workspaces: vi.fn(async () => structuredClone(data)),
    workspaceChats: vi.fn(async () => []),
    addWorkspaceMember: vi.fn(async () => {}),
    removeWorkspaceMember: vi.fn(async () => {}),
  }) as Repository;
  return { repo, set: (next: Workspaces) => { data = next; } };
}

beforeEach(() => localStorage.setItem('aisar-lang', 'en'));

describe('workspaces on the Team tab', () => {
  it('lists each workspace with its members', async () => {
    mount({ workspaces: [MARKETING], canManage: false });
    const list = await screen.findByRole('list', { name: 'Workspaces' });
    expect(within(list).getByText('Marketing')).toBeInTheDocument();
    const members = within(list).getByRole('list', { name: 'Marketing · Members' });
    expect(within(members).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['owner@example.com · you', 'aisha@example.com']);
    expect(screen.queryByLabelText('New workspace name')).toBeNull();
  });

  it('lets the owner create one with chosen members', async () => {
    const created: Workspace = { ...MARKETING, id: 'w2', name: 'Ops', members: [MARKETING.members[0], { userId: 'u3', email: 'ravi@example.com', you: false }] };
    const createWorkspace = vi.fn(async () => created);
    mount({ workspaces: [MARKETING], canManage: true }, { createWorkspace });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New workspace name'), 'Ops');
    await user.click(screen.getByRole('checkbox', { name: 'ravi@example.com' }));
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(createWorkspace).toHaveBeenCalledWith('Ops', ['u3']);
    const list = screen.getByRole('list', { name: 'Workspaces' });
    await waitFor(() => expect(within(list).getByText('Ops')).toBeInTheDocument());
  });

  it('lets the owner add and remove members', async () => {
    const addWorkspaceMember = vi.fn(async () => {});
    const removeWorkspaceMember = vi.fn(async () => {});
    mount({ workspaces: [MARKETING], canManage: true }, { addWorkspaceMember, removeWorkspaceMember });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Add a member to Marketing'), 'u3');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(addWorkspaceMember).toHaveBeenCalledWith('w1', 'u3');
    await user.click(screen.getByRole('button', { name: 'Remove aisha@example.com from Marketing' }));
    expect(removeWorkspaceMember).toHaveBeenCalledWith('w1', 'u2');
  });
});

describe('workspaces through the cache', () => {
  it('reads /api/workspaces once for the chat screen and the Team panel together', async () => {
    const { repo } = teamRepo({ workspaces: [MARKETING], canManage: true });
    await page(repo);
    await screen.findByRole('list', { name: 'Workspaces' });
    await waitFor(() => expect(screen.getByTestId('shared')).toHaveTextContent('Marketing'));
    expect(repo.workspaces).toHaveBeenCalledTimes(1);
  });

  it('shows the panel again on a return inside 30 s without asking', async () => {
    const { repo } = teamRepo({ workspaces: [MARKETING], canManage: true });
    const client = createTestQueryClient();
    const first = await page(repo, { chat: false, client });
    await screen.findByRole('list', { name: 'Workspaces' });
    first.unmount();
    await page(repo, { chat: false, client });
    expect(screen.getByRole('list', { name: 'Workspaces' })).toBeInTheDocument();
    expect(repo.workspaces).toHaveBeenCalledTimes(1);
  });

  /* Adding yourself to a workspace in Team settings used to leave the chat
     screen's shared chats as they were until the page was reloaded. */
  it('brings a membership change to the chat screen\'s shared chats at once', async () => {
    const outside: Workspace = { ...MARKETING, member: false, members: [MARKETING.members[1]] };
    const { repo, set } = teamRepo({ workspaces: [outside], canManage: true });
    await page(repo);
    await screen.findByRole('list', { name: 'Workspaces' });
    await waitFor(() => expect(repo.workspaces).toHaveBeenCalled());
    expect(screen.getByTestId('shared')).toHaveTextContent('none');
    set({ workspaces: [MARKETING], canManage: true });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Add a member to Marketing'), 'u1');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByTestId('shared')).toHaveTextContent('Marketing'));
  });

  it('keeps the list when reading it again fails', async () => {
    const { repo } = teamRepo({ workspaces: [MARKETING], canManage: true });
    const { client } = await page(repo, { chat: false });
    await screen.findByRole('list', { name: 'Workspaces' });
    vi.mocked(repo.workspaces!).mockRejectedValue(new Error('offline'));
    await returnToApp(client);
    await waitFor(() => expect(repo.workspaces).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('list', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
