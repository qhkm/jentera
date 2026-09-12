import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from '@/components/AccountMenu';
import { ToastProvider } from '@/components/Toast';
import { DetailLevelProvider } from '@/hooks/useDetailLevel';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import type { Repository } from '@/lib/repo';

const KEY = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';

function mount(repo: Repository, { signedIn = true } = {}) {
  return render(
    <SignedInProvider value={signedIn}>
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

function pushCapableBrowser() {
  let current: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = { endpoint: 'https://push.example/1', toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => true };
      return current;
    }),
  };
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: Promise.resolve({ pushManager }) } });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'granted') });
  return pushManager;
}

function pushRepo(): Repository {
  const repo: Repository = new LocalRepository();
  repo.pushPublicKey = vi.fn(async () => KEY);
  repo.savePushSubscription = vi.fn(async () => 'saved' as const);
  repo.deletePushSubscription = vi.fn(async () => undefined);
  return repo;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aisar-lang', 'en');
});
afterEach(() => vi.unstubAllGlobals());

describe('notifications on this device, from the account menu', () => {
  it('keeps failure guidance in the menu and lets Enable retry registration', async () => {
    const manager = pushCapableBrowser();
    manager.subscribe.mockRejectedValueOnce(new DOMException('registration failed', 'AbortError'));
    const user = userEvent.setup();
    mount(pushRepo());
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Notifications on this device/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('PUSH_BROWSER');
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    const item = await screen.findByRole('menuitem', { name: /Notifications on this device/ });
    expect(item).toHaveAccessibleDescription(/PUSH_BROWSER/);
    await user.click(item);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("You'll get Jentera's updates"));
  });

  it('offers the switch only where the browser can receive push', async () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: undefined });
    const user = userEvent.setup();
    mount(pushRepo());
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: /Notifications on this device/ })).not.toBeInTheDocument();
  });

  it('turns notifications on for the device and says so', async () => {
    const pushManager = pushCapableBrowser();
    const repo = pushRepo();
    const user = userEvent.setup();
    mount(repo);
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    const item = await screen.findByRole('menuitem', { name: /Notifications on this device/ });
    expect(item).toHaveTextContent('Off');
    await user.click(item);
    await waitFor(() => expect(pushManager.subscribe).toHaveBeenCalledOnce());
    expect(repo.savePushSubscription).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent("You'll get Jentera's updates on this device.");
  });

  it('explains a blocked permission instead of failing silently', async () => {
    pushCapableBrowser();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'denied') });
    const user = userEvent.setup();
    mount(pushRepo());
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Notifications on this device/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(/blocked/i);
  });
});
