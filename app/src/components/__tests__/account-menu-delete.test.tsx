import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from '@/components/AccountMenu';
import { ToastProvider } from '@/components/Toast';
import { DetailLevelProvider } from '@/hooks/useDetailLevel';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import type { Repository } from '@/lib/repo';

function mount(repo: Repository, { email = null as string | null } = {}) {
  return render(
    <SignedInProvider value={true} account="user-1" email={email}>
      <RepositoryProvider repository={repo}>
        <I18nProvider>
          <ToastProvider>
            <DetailLevelProvider><AccountMenu onSignOut={vi.fn()} /></DetailLevelProvider>
          </ToastProvider>
        </I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aisar-lang', 'en');
});
afterEach(() => vi.unstubAllGlobals());

describe('deleting the account from the menu', () => {
  it('is reachable from the account menu and confirms with the typed address', async () => {
    vi.stubGlobal('location', { ...window.location, href: '' });
    const repo: Repository = new LocalRepository();
    repo.requestAccountDeletion = vi.fn(async () => ({ graceDays: 7, routines: 0 }));
    const user = userEvent.setup();
    mount(repo, { email: 'owner@example.com' });

    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    const entry = await screen.findByRole('menuitem', { name: /delete my account/i });
    await user.click(entry);

    // The consequences are shown before any confirmation is possible.
    expect(screen.getByText(/signed out on every device now/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /delete permanently/i });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/type your email/i), 'owner@example.com');
    await user.click(confirm);

    expect(repo.requestAccountDeletion).toHaveBeenCalledWith('owner@example.com');
  });

  it('returns to the normal menu when the owner keeps the account', async () => {
    const repo: Repository = new LocalRepository();
    repo.requestAccountDeletion = vi.fn();
    const user = userEvent.setup();
    mount(repo, { email: 'owner@example.com' });

    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /keep my account/i }));

    expect(await screen.findByRole('menuitem', { name: /delete my account/i })).toBeInTheDocument();
    expect(repo.requestAccountDeletion).not.toHaveBeenCalled();
  });

  it('does not offer account deletion when no address is known yet', async () => {
    const repo: Repository = new LocalRepository();
    const user = userEvent.setup();
    mount(repo, { email: null });

    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: /delete my account/i })).not.toBeInTheDocument();
  });
});
