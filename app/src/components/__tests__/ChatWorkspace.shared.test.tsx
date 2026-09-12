import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationList } from '@/components/ChatWorkspace';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';

beforeEach(() => localStorage.setItem('aisar-lang', 'en'));

describe('shared chats in the conversation list', () => {
  it('lists each workspace\'s chats with who opened them, and offers a new chat inside it', async () => {
    const onOpenShared = vi.fn();
    const onNewIn = vi.fn();
    render(
      <RepositoryProvider repository={new LocalRepository()}><I18nProvider>
        <ConversationList
          sessions={[]} activeId="" businessName="Kitakod" onOpen={() => {}} onNew={() => {}} onDelete={() => {}}
          shared={{
            loading: false, onOpenShared, onNewIn,
            workspaces: [{
              id: 'w1', name: 'Marketing', createdAt: '2026-09-12T00:00:00.000Z', member: true, members: [],
              chats: [{ id: 'c1', title: 'Draft the campaign brief', createdBy: 'aisha@example.com', createdAt: '2026-09-12T01:00:00.000Z', lastAt: '2026-09-12T01:05:00.000Z', turns: 2 }],
            }],
          }}
        />
      </I18nProvider></RepositoryProvider>,
    );
    const section = await screen.findByRole('region', { name: 'Shared in Marketing' });
    expect(within(section).getByText(/by aisha/)).toBeInTheDocument();
    expect(within(section).getByText(/2 turns/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(section).getByRole('button', { name: 'Open shared chat Draft the campaign brief' }));
    expect(onOpenShared).toHaveBeenCalledWith('c1');
    await user.click(within(section).getByRole('button', { name: 'New chat in Marketing' }));
    expect(onNewIn).toHaveBeenCalledWith('w1');
  });
});
