import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import BotsPanel from '../BotsPanel';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';

function mount(repo = new LocalRepository(), startCreating = false) {
  render(<RepositoryProvider repository={repo}><I18nProvider><BotsPanel startCreating={startCreating} /></I18nProvider></RepositoryProvider>);
  return repo;
}
beforeEach(() => localStorage.clear());

describe('AI bots', () => {
  it('opens the creator directly from the chat roster New bot action', async () => {
    mount(new LocalRepository(), true);
    expect(await screen.findByRole('heading', { name: 'Add bot' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bot name')).toHaveFocus();
  });

  it('creates a real profile with its chosen avatar and persists a personal default', async () => {
    const repo = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add bot' }));
    await user.type(screen.getByLabelText('Bot name'), 'Invoice buddy');
    await user.type(screen.getByLabelText('What does this bot help with?'), 'Review invoices');
    await user.type(screen.getByLabelText('Instructions'), 'Ask before sending anything');
    await user.click(screen.getByRole('radio', { name: 'Cat' }));
    await user.click(screen.getByRole('button', { name: 'Save bot' }));
    const card = await screen.findByRole('article', { name: 'Invoice buddy' });
    await user.click(within(card).getByRole('button', { name: 'Make default' }));
    await waitFor(() => expect(within(card).getByText('Your default')).toBeInTheDocument());
    const saved = await new LocalRepository().load();
    const bot = saved.specialists.find(b => b.name === 'Invoice buddy')!;
    expect(bot).toMatchObject({ avatar: 'cat', instructions: 'Ask before sending anything' });
    expect(saved.defaultBotProfile).toBe(bot.profile);
    expect((await repo.load()).coordinatorAvatar).toBe('original');
  });

  it('changes the Jentera avatar and cancels edits without persisting them', async () => {
    const repo = mount(); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Choose avatar' }));
    await user.click(screen.getByRole('radio', { name: 'Wing' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((await repo.load()).coordinatorAvatar).toBe('original');
    await user.click(screen.getByRole('button', { name: 'Choose avatar' }));
    await user.click(screen.getByRole('radio', { name: 'Operator' }));
    await user.click(screen.getByRole('button', { name: 'Save avatar' }));
    await screen.findByRole('status');
    expect((await repo.load()).coordinatorAvatar).toBe('operator');
  });

  it('requires confirmation to disable and falls back to Jentera', async () => {
    const repo = new LocalRepository();
    await repo.setBotPreference({ defaultBotProfile: 'operations', coordinatorAvatar: 'wing' });
    mount(repo); const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Operations' });
    await user.click(within(card).getByRole('button', { name: 'Disable bot' }));
    expect((await repo.load()).specialists).toHaveLength(4);
    await user.click(within(card).getByRole('button', { name: 'Confirm disable' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Operations' })).toBeNull());
    expect((await repo.load()).defaultBotProfile).toBe('default');
    expect((await repo.load()).coordinatorAvatar).toBe('wing');
  });

  it('lets staff choose a default but not edit shared bots', async () => {
    const repo = new LocalRepository(); const load = repo.load.bind(repo);
    repo.load = async () => ({ ...await load(), canManageBots: false });
    mount(repo);
    await screen.findByRole('heading', { name: 'Your AI bots' });
    expect(screen.queryByRole('button', { name: 'Add bot' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit bot' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Make default' })).toHaveLength(4);
  });

  it('surfaces a failed save and keeps the editor open', async () => {
    const repo = new LocalRepository(); repo.setBotPreference = async () => { throw new Error('Offline'); };
    mount(repo); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Choose avatar' }));
    await user.click(screen.getByRole('button', { name: 'Save avatar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.getByRole('button', { name: 'Save avatar' })).toBeEnabled();
  });
});
