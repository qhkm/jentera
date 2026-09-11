import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePwaInstall, type InstallPromptEvent } from '@/pwa/install';

function installPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

afterEach(() => {
  /* The browser fires this once the app is on the home screen; it also
     clears any prompt the module was holding between tests. */
  act(() => { window.dispatchEvent(new Event('appinstalled')); });
  vi.unstubAllGlobals();
});

describe('usePwaInstall', () => {
  it('offers nothing until the browser says the app can be installed', () => {
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canPrompt).toBe(false);
    expect(result.current.iosHint).toBe(false);
  });

  it("keeps the browser's install prompt and shows it on request", async () => {
    const event = installPrompt('accepted');
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);

    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canPrompt).toBe(true);

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.promptInstall(); });
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(outcome).toBe('accepted');
    expect(result.current.canPrompt).toBe(false);
  });

  it('remembers a prompt that arrived before any component mounted', () => {
    act(() => { window.dispatchEvent(installPrompt()); });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canPrompt).toBe(true);
  });

  it('points an iPhone at Add to Home Screen, since Safari never prompts', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canPrompt).toBe(false);
    expect(result.current.iosHint).toBe(true);
    expect(result.current.standalone).toBe(false);
  });

  it('offers nothing once the app is already running from the home screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone'), media: query, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.standalone).toBe(true);
    expect(result.current.iosHint).toBe(false);
  });
});
