import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BotCreatorDialog from '../BotCreatorDialog';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

describe('inline bot creator', () => {
  it('creates a bot without leaving chat and returns its profile', async () => {
    const repo = new LocalRepository();
    const onCreated = vi.fn();
    render(<RepositoryProvider repository={repo}><I18nProvider>
      <BotCreatorDialog open onClose={vi.fn()} onCreated={onCreated} />
    </I18nProvider></RepositoryProvider>);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Bot name'), 'Campaign lead');
    await user.type(screen.getByLabelText('What does this bot help with?'), 'Plans our campaigns');
    await user.click(screen.getByRole('radio', { name: 'Rose' }));
    await user.click(screen.getByRole('button', { name: 'Create and chat' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    const saved = (await repo.load()).specialists.find(bot => bot.name === 'Campaign lead');
    expect(saved).toMatchObject({ description: 'Plans our campaigns', avatar: 'pink' });
    expect(onCreated).toHaveBeenCalledWith(saved?.profile);
  });
});
