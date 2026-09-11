import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/AccountMenu';
import { ToastProvider } from '@/components/Toast';
import { DetailLevelProvider } from '@/hooks/useDetailLevel';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import type { InstallPromptEvent } from '@/pwa/install';

function mount(children: ReactNode, { signedIn = true } = {}) {
  return render(
    <SignedInProvider value={signedIn}>
      <RepositoryProvider repository={new LocalRepository()}>
        <I18nProvider>
          <ToastProvider>
            <DetailLevelProvider>{children}</DetailLevelProvider>
          </ToastProvider>
        </I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

function installPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });
  return event;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aisar-lang', 'en');
});

afterEach(() => {
  act(() => { window.dispatchEvent(new Event('appinstalled')); });
  vi.unstubAllGlobals();
});

describe('installing Jentera from the account menu', () => {
  it('shows nothing when the browser has not offered to install', async () => {
    const user = userEvent.setup();
    mount(<AccountMenu onSignOut={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: 'Install Jentera app' })).not.toBeInTheDocument();
  });

  it("shows the browser's install prompt from the menu when it is available", async () => {
    const user = userEvent.setup();
    const event = installPrompt();
    act(() => { window.dispatchEvent(event); });
    mount(<AccountMenu onSignOut={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Install Jentera app' }));
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it('tells an iPhone owner where Add to Home Screen lives', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' });
    const user = userEvent.setup();
    mount(<AccountMenu onSignOut={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Install Jentera app' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Share.*Add to Home Screen/);
  });
});
