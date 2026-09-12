import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspacesPanel from '@/routes/views/WorkspacesPanel';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import type { Repository, TeamMember, Workspace, Workspaces } from '@/lib/repo';

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
    <SignedInProvider value account="owner" teamVersion={1}>
      <RepositoryProvider repository={repo}>
        <I18nProvider><ToastProvider><WorkspacesPanel members={MEMBERS} /></ToastProvider></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
  return repo;
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
