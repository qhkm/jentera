import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { useSharedChats } from '@/hooks/useSharedChats';
import { LocalRepository } from '@/lib/repo/local';
import type { Repository, Workspace, WorkspaceChat, Workspaces } from '@/lib/repo';
import { renderWithQuery, returnToApp } from '@/test-support/query';

const workspace = (id: string, name: string, member = true): Workspace => ({
  id, name, member, members: [], createdAt: '2026-09-12T00:00:00.000Z',
});
const chat = (id: string, title: string): WorkspaceChat => ({
  id, title, createdBy: 'aisha@example.com', createdAt: '2026-09-12T01:00:00.000Z', lastAt: '2026-09-12T01:05:00.000Z', turns: 2,
});

/** A team business: Marketing (a member), Finance (not a member). */
function teamRepo() {
  const repo: Repository = new LocalRepository();
  const list: Workspaces = { canManage: true, workspaces: [workspace('w1', 'Marketing'), workspace('w2', 'Finance', false)] };
  const chats: Record<string, WorkspaceChat[]> = { w1: [chat('c1', 'Draft the campaign brief')] };
  repo.workspaces = vi.fn(async () => structuredClone(list));
  repo.workspaceChats = vi.fn(async (id: string) => structuredClone(chats[id] ?? []));
  return { repo, list, chats };
}

function Probe({ enabled = true, id = 'shared' }: { enabled?: boolean; id?: string }) {
  const { workspaces, loading, reload } = useSharedChats(enabled);
  return <div>
    <span data-testid={id}>{workspaces.map((w) => `${w.name}:${w.chats.map((c) => c.title).join('+') || '-'}`).join(' | ') || 'none'}</span>
    <span data-testid={`${id}-loading`}>{String(loading)}</span>
    <button type="button" onClick={reload}>Read shared chats again</button>
  </div>;
}

const mount = (repo: Repository, enabled = true, client?: QueryClient) =>
  renderWithQuery(<Probe enabled={enabled} />, { repository: repo, client });

describe('shared chats', () => {
  it('lists the workspaces this person is in with their chats, and a workspace whose chats fail with none', async () => {
    const { repo, list } = teamRepo();
    list.workspaces.push(workspace('w3', 'Ops'));
    repo.workspaceChats = vi.fn(async (id: string) => {
      if (id === 'w3') throw new Error('down');
      return [chat('c1', 'Draft the campaign brief')];
    });
    await mount(repo);
    await waitFor(() => expect(screen.getByTestId('shared')).toHaveTextContent('Marketing:Draft the campaign brief | Ops:-'));
    expect(repo.workspaceChats).not.toHaveBeenCalledWith('w2');
  });

  it('reads nothing off the team plan', async () => {
    const { repo } = teamRepo();
    await mount(repo, false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByTestId('shared')).toHaveTextContent('none');
    expect(repo.workspaces).not.toHaveBeenCalled();
  });

  it('reads them once for two screens that show them', async () => {
    const { repo } = teamRepo();
    await renderWithQuery(<><Probe id="one" /><Probe id="two" /></>, { repository: repo });
    await waitFor(() => expect(screen.getByTestId('two')).toHaveTextContent('Marketing'));
    expect(repo.workspaces).toHaveBeenCalledTimes(1);
  });

  /* They were read once, when the chat screen mounted: a colleague's new
     chat showed only after a reload of the page. */
  it('reads them again when the owner comes back to the app', async () => {
    const { repo, chats } = teamRepo();
    const { client } = await mount(repo);
    await waitFor(() => expect(screen.getByTestId('shared')).toHaveTextContent('Draft the campaign brief'));
    chats.w1.push(chat('c2', 'Price the new menu'));
    await returnToApp(client);
    await waitFor(() => expect(screen.getByTestId('shared')).toHaveTextContent('Draft the campaign brief+Price the new menu'));
  });

  /* A failed read used to empty the list until the next one worked. */
  it('keeps the list when reading it again fails', async () => {
    const { repo } = teamRepo();
    const { client } = await mount(repo);
    await waitFor(() => expect(screen.getByTestId('shared')).toHaveTextContent('Marketing'));
    vi.mocked(repo.workspaces!).mockRejectedValue(new Error('offline'));
    await returnToApp(client);
    await waitFor(() => expect(repo.workspaces).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('shared-loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('shared')).toHaveTextContent('Marketing:Draft the campaign brief');
  });

  it('keeps the list on screen while it is read again', async () => {
    const { repo } = teamRepo();
    await mount(repo);
    await waitFor(() => expect(screen.getByTestId('shared')).toHaveTextContent('Marketing'));
    let release!: (w: Workspaces) => void;
    vi.mocked(repo.workspaces!).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await userEvent.click(screen.getByRole('button', { name: 'Read shared chats again' }));
    await waitFor(() => expect(screen.getByTestId('shared-loading')).toHaveTextContent('true'));
    expect(screen.getByTestId('shared')).toHaveTextContent('Marketing:Draft the campaign brief');
    await act(async () => release({ canManage: true, workspaces: [workspace('w1', 'Marketing')] }));
    await waitFor(() => expect(screen.getByTestId('shared-loading')).toHaveTextContent('false'));
  });
});
