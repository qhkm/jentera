import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallNudge, NOTIFICATION_NUDGE_KEY } from '@/components/InstallNudge';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';

const push = vi.hoisted(() => ({
  state: 'off' as 'off' | 'on' | 'denied' | 'checking' | 'unsupported',
  busy: false,
  enable: vi.fn(async () => 'on' as const),
  disable: vi.fn(async () => undefined),
}));

vi.mock('@/pwa/push', () => ({ usePushNotifications: () => push }));

function mount({ signedIn = true } = {}) {
  return render(
    <SignedInProvider value={signedIn}>
      <RepositoryProvider repository={new LocalRepository()}>
        <I18nProvider><InstallNudge delayMs={0} /></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aisar-lang', 'en');
  push.state = 'off';
  push.busy = false;
  push.enable.mockClear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('standalone'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  act(() => { window.dispatchEvent(new Event('appinstalled')); });
  vi.unstubAllGlobals();
});

describe('post-install notification nudge', () => {
  it('asks an owner to enable notifications after launching the installed app', async () => {
    const user = userEvent.setup();
    mount();
    const nudge = await screen.findByRole('region', { name: /turn on jentera notifications/i });
    expect(nudge).toHaveTextContent(/even when Jentera is closed/i);
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(push.enable).toHaveBeenCalledOnce();
  });

  it('stays away when notifications are already active or the viewer is signed out', () => {
    push.state = 'on';
    const active = mount();
    expect(screen.queryByRole('region', { name: /turn on jentera notifications/i })).not.toBeInTheDocument();
    active.unmount();

    push.state = 'off';
    mount({ signedIn: false });
    expect(screen.queryByRole('region', { name: /turn on jentera notifications/i })).not.toBeInTheDocument();
  });

  it('explains how to recover when permission is blocked', async () => {
    push.state = 'denied';
    mount();
    const nudge = await screen.findByRole('region', { name: /turn on jentera notifications/i });
    expect(nudge).toHaveTextContent(/browser and phone settings/i);
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
  });

  it('can be snoozed without changing the install reminder preference', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(Number(localStorage.getItem(NOTIFICATION_NUDGE_KEY))).toBeGreaterThan(Date.now() - 5_000);
    expect(localStorage.getItem('jentera-install-nudge-v1')).toBeNull();
  });
});
