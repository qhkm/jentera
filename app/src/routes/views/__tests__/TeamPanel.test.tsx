import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamPanel from '@/routes/views/TeamPanel';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/Toast';
import type { Repository, Team, TeamInvitation } from '@/lib/repo';

const TEAM: Team = {
  members: [
    { userId: 'u1', email: 'owner@example.com', role: 'owner', joinedAt: '2026-09-01T00:00:00.000Z', you: true },
    { userId: 'u2', email: 'aisha@example.com', role: 'staff', joinedAt: '2026-09-10T00:00:00.000Z', you: false },
  ],
  invitations: [
    { id: 'i1', email: 'ravi@example.com', role: 'staff', createdAt: '2026-09-12T00:00:00.000Z', expiresAt: '2026-09-19T00:00:00.000Z' },
  ],
  canManage: true,
};

function mount(team: Team, over: Partial<Pick<Repository, 'inviteTeamMember' | 'revokeTeamInvitation'>> = {}) {
  const repo = Object.assign(new LocalRepository(), { team: vi.fn(async () => team) }, over) as Repository;
  render(
    <SignedInProvider value account="owner" teamVersion={1}>
      <RepositoryProvider repository={repo}>
        <I18nProvider><ToastProvider><TeamPanel /></ToastProvider></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
  return repo;
}

beforeEach(() => localStorage.setItem('aisar-lang', 'en'));

describe('the team tab', () => {
  it('lists members with their roles and the invitations still waiting', async () => {
    mount(TEAM);
    const members = await screen.findByRole('list', { name: 'Members' });
    const rows = within(members).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('owner@example.com');
    expect(rows[0]).toHaveTextContent('you');
    expect(rows[0]).toHaveTextContent('Owner');
    expect(rows[1]).toHaveTextContent('Staff');
    const waiting = screen.getByRole('list', { name: 'Invitations waiting' });
    expect(within(waiting).getByText(/ravi@example.com/)).toBeInTheDocument();
  });

  it('lets the owner invite an address and shows it as waiting', async () => {
    const invitation: TeamInvitation = { id: 'i2', email: 'new@example.com', role: 'staff', createdAt: '2026-09-12T01:00:00.000Z', expiresAt: '2026-09-19T01:00:00.000Z' };
    const inviteTeamMember = vi.fn(async () => invitation);
    mount(TEAM, { inviteTeamMember });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Invite by email'), 'New@Example.com');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(inviteTeamMember).toHaveBeenCalledWith('New@Example.com');
    const waiting = screen.getByRole('list', { name: 'Invitations waiting' });
    await waitFor(() => expect(within(waiting).getByText(/new@example.com/)).toBeInTheDocument());
    expect(screen.getByLabelText('Invite by email')).toHaveValue('');
  });

  it('lets the owner revoke an invitation', async () => {
    const revokeTeamInvitation = vi.fn(async () => {});
    mount(TEAM, { revokeTeamInvitation });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke ravi@example.com' }));
    expect(revokeTeamInvitation).toHaveBeenCalledWith('i1');
    await waitFor(() => expect(screen.getByText('No invitations waiting.')).toBeInTheDocument());
  });

  it('shows staff the team without any way to change it', async () => {
    mount({ ...TEAM, canManage: false }, { inviteTeamMember: vi.fn(async () => TEAM.invitations[0]), revokeTeamInvitation: vi.fn(async () => {}) });
    await screen.findByRole('list', { name: 'Members' });
    expect(screen.queryByLabelText('Invite by email')).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
  });
});
