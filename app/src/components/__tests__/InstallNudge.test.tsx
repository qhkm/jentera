import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallNudge, INSTALL_NUDGE_KEY } from '@/components/InstallNudge';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import { LocalRepository } from '@/lib/repo/local';
import type { InstallPromptEvent } from '@/pwa/install';

function mount({ signedIn = true, delayMs = 0 } = {}) {
  return render(
    <SignedInProvider value={signedIn}>
      <RepositoryProvider repository={new LocalRepository()}>
        <I18nProvider><InstallNudge delayMs={delayMs} /></I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
}

function installPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aisar-lang', 'en');
});
afterEach(() => {
  act(() => { window.dispatchEvent(new Event('appinstalled')); });
  vi.unstubAllGlobals();
});

describe('InstallNudge', () => {
  it('stays away when the browser has not offered to install and this is not an iPhone', async () => {
    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('region', { name: /install jentera/i })).not.toBeInTheDocument();
  });

  it("offers the browser's install once the page has settled, and shows the prompt on Install", async () => {
    const event = installPrompt();
    act(() => { window.dispatchEvent(event); });
    const user = userEvent.setup();
    mount();
    const nudge = await screen.findByRole('region', { name: /install jentera/i });
    expect(nudge).toHaveTextContent(/notifications/i);
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it('goes quiet for a month on Not now', async () => {
    act(() => { window.dispatchEvent(installPrompt()); });
    const user = userEvent.setup();
    const first = mount();
    await screen.findByRole('region', { name: /install jentera/i });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: /install jentera/i })).not.toBeInTheDocument();
    expect(Number(localStorage.getItem(INSTALL_NUDGE_KEY))).toBeGreaterThan(Date.now() - 5_000);
    first.unmount();

    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('region', { name: /install jentera/i })).not.toBeInTheDocument();
  });

  it('comes back once the month is over', async () => {
    localStorage.setItem(INSTALL_NUDGE_KEY, String(Date.now() - 31 * 24 * 60 * 60 * 1000));
    act(() => { window.dispatchEvent(installPrompt()); });
    mount();
    expect(await screen.findByRole('region', { name: /install jentera/i })).toBeInTheDocument();
  });

  it('tells an iPhone owner how to add it, since Safari never asks', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: IPHONE });
    const user = userEvent.setup();
    mount();
    const nudge = await screen.findByRole('region', { name: /install jentera/i });
    expect(nudge).toHaveTextContent(/Share.*Add to Home Screen/);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: /install jentera/i })).not.toBeInTheDocument();
  });

  it('never shows to the anonymous demo, or once the app runs from the home screen', async () => {
    act(() => { window.dispatchEvent(installPrompt()); });
    const demo = mount({ signedIn: false });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('region', { name: /install jentera/i })).not.toBeInTheDocument();
    demo.unmount();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone'), media: query, addEventListener() {}, removeEventListener() {} }));
    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('region', { name: /install jentera/i })).not.toBeInTheDocument();
  });
});
