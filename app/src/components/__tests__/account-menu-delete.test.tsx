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

function mount(
  repo: Repository,
  { email = null as string | null, routinesVersion }: { email?: string | null; routinesVersion?: number } = {},
) {
  return render(
    <SignedInProvider value={true} account="user-1" email={email} routinesVersion={routinesVersion}>
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
    repo.requestAccountDeletion = vi.fn(async () => ({ graceDays: 7, routines: 0, noticeSent: true }));
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

  it('says what just happened instead of leaving the page at once', async () => {
    /* The response carries the only facts the person has — seven days,
       signed out everywhere, a cancel link in their inbox, and how many
       scheduled jobs stop. Navigating on success threw all four away. */
    const location = { ...window.location, href: '' };
    vi.stubGlobal('location', location);
    const repo: Repository = new LocalRepository();
    repo.requestAccountDeletion = vi.fn(async () => ({ graceDays: 7, routines: 2, noticeSent: true }));
    const user = userEvent.setup();
    mount(repo, { email: 'owner@example.com' });

    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete my account/i }));
    await user.type(screen.getByLabelText(/type your email/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    expect(await screen.findByText(/scheduled for deletion/i)).toBeInTheDocument();
    expect(screen.getByText(/signed out on every device/i)).toBeInTheDocument();
    expect(screen.getByText(/erased in 7 days/i)).toBeInTheDocument();
    /* The server's number, not the one counted before the request. */
    expect(screen.getByText(/2 scheduled jobs you set up will stop/i)).toBeInTheDocument();
    expect(screen.getByText(/cancel is in your inbox/i)).toBeInTheDocument();
    expect(location.href).toBe('');

    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(location.href).toBe('/');
  });

  it('does not claim a cancel link was sent when it was not', async () => {
    vi.stubGlobal('location', { ...window.location, href: '' });
    const repo: Repository = new LocalRepository();
    repo.requestAccountDeletion = vi.fn(async () => ({ graceDays: 7, routines: 0, noticeSent: false }));
    const user = userEvent.setup();
    mount(repo, { email: 'owner@example.com' });

    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete my account/i }));
    await user.type(screen.getByLabelText(/type your email/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    expect(await screen.findByText(/could not email/i)).toBeInTheDocument();
    expect(screen.queryByText(/cancel is in your inbox/i)).not.toBeInTheDocument();
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
