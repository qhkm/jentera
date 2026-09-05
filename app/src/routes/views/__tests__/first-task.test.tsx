import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AskJenteraView from '@/routes/views/AskJenteraView';
import { LocalRepository } from '@/lib/repo/local';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ActivityProvider } from '@/hooks/useActivity';
import { resolveBusiness } from '@/lib/business';
import type { Activity } from '@/lib/repo';

vi.mock('@/hooks/useMediaQuery', () => ({ useIsCompact: () => false }));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

async function mount(repo: LocalRepository, signedIn = true) {
  const business = resolveBusiness(await repo.load(), 'restaurant');
  return render(
    <SignedInProvider value={signedIn}>
      <RepositoryProvider repository={repo}>
        <I18nProvider><ActivityProvider>
          <AskJenteraView business={business} handled={0} needs={0} />
        </ActivityProvider></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

describe('first task in web chat', () => {
  it('starts a private draft without a connector, preserves the question on failure, and retries', async () => {
    const repo = new LocalRepository();
    const ask = vi.fn()
      .mockRejectedValueOnce(new Error('Connection lost. Please try again.'))
      .mockResolvedValueOnce({ text: 'Here is your draft reply.', usedKeys: [], grounded: false });
    repo.ask = ask;
    await mount(repo);

    expect(ask).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft a customer reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('placeholders for any missing details'), expect.objectContaining({ mode: 'work' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try this again' }));
    expect(await screen.findByText('Here is your draft reply.')).toBeInTheDocument();
    expect(ask.mock.calls[1][0]).toBe(ask.mock.calls[0][0]);
    expect(screen.queryByRole('button', { name: 'Draft a customer reply' })).toBeNull();
  });

  it('keeps the invitation after a reload until a first task starts', async () => {
    const repo = new LocalRepository();
    const mounted = await mount(repo);
    await screen.findByRole('button', { name: 'Plan my week' });
    mounted.unmount();
    await mount(repo);
    expect(await screen.findByRole('button', { name: 'Plan my week' })).toBeInTheDocument();
  });

  it('localises the task choices and the submitted task to BM', async () => {
    const repo = new LocalRepository();
    await repo.setLang('bm');
    repo.ask = vi.fn().mockResolvedValue({ text: 'Draf anda.', usedKeys: [], grounded: false });
    await mount(repo);
    await userEvent.click(await screen.findByRole('button', { name: 'Tulis promosi' }));
    expect(repo.ask).toHaveBeenCalledWith(expect.stringContaining('Draf promosi ringkas'), expect.objectContaining({ mode: 'work' }));
  });

  it('does not infer an empty account from pending or failed activity', async () => {
    const repo = new LocalRepository();
    let reject: (error: Error) => void = () => {};
    repo.activity = () => new Promise<Activity>((_resolve, fail) => { reject = fail; });
    await mount(repo);
    await screen.findByRole('combobox');
    expect(screen.queryByRole('button', { name: 'Plan my week' })).toBeNull();
    await act(async () => reject(new Error('offline')));
    expect(screen.queryByRole('button', { name: 'Plan my week' })).toBeNull();
  });
});
