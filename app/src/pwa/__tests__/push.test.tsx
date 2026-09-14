import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { Repository } from '@/lib/repo';
import { usePushNotifications } from '@/pwa/push';

const KEY = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';

function fakeSubscription(endpoint: string) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function browser({ existing = null as ReturnType<typeof fakeSubscription> | null, permission = 'default' } = {}) {
  let current = existing;
  let n = 0;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => { current = fakeSubscription(`https://push.example/${++n}`); return current; }),
  };
  const registration = { pushManager };
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: Object.assign(new EventTarget(), { ready: Promise.resolve(registration) }) });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => 'granted') });
  return pushManager;
}

function repoWith(overrides: Partial<Repository> = {}): Repository {
  const repo: Repository = new LocalRepository();
  repo.pushPublicKey = vi.fn(async () => KEY);
  repo.savePushSubscription = vi.fn(async () => 'saved' as const);
  repo.deletePushSubscription = vi.fn(async () => undefined);
  return Object.assign(repo, overrides);
}

const wrapper = (repo: Repository) => ({ children }: { children: ReactNode }) => (
  <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
);

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('usePushNotifications', () => {
  it('restores existing push after an update-time failure without subscribing again', async () => {
    const existing = fakeSubscription('https://push.example/existing');
    const manager = browser({ existing, permission: 'granted' });
    manager.getSubscription.mockRejectedValueOnce(new Error('worker replacing'));
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('unknown'));
    act(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await waitFor(() => expect(result.current.state).toBe('on'));
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('keeps confirmed on state during temporary lookup failures and recovers online', async () => {
    const manager = browser({ existing: fakeSubscription('https://push.example/existing'), permission: 'granted' });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('on'));
    manager.getSubscription.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(result.current.state).toBe('on');
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(result.current.state).toBe('on');
    expect(manager.getSubscription).toHaveBeenCalledTimes(3);
  });

  it('automatically retries a transient initial failure once', async () => {
    vi.useFakeTimers();
    const manager = browser({ existing: fakeSubscription('https://push.example/existing') });
    manager.getSubscription.mockRejectedValueOnce(new Error('updating'));
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe('unknown');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(result.current.state).toBe('on');
    expect(manager.getSubscription).toHaveBeenCalledTimes(2);
  });

  it('bounds repeated failures and removes listeners and retries on unmount', async () => {
    vi.useFakeTimers();
    const manager = browser();
    manager.getSubscription.mockRejectedValue(new Error('offline'));
    const { result, unmount } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.state).toBe('unknown');
    expect(manager.getSubscription).toHaveBeenCalledTimes(2);
    unmount();
    window.dispatchEvent(new Event('focus'));
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(manager.getSubscription).toHaveBeenCalledTimes(2);
  });

  it('does not silently enable a missing subscription even with granted permission', async () => {
    const manager = browser({ permission: 'granted' });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    await act(async () => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    expect(result.current.state).toBe('off');
    expect(manager.subscribe).not.toHaveBeenCalled();
  });

  it('detects revoked browser permission when returning to the app', async () => {
    browser({ existing: fakeSubscription('https://push.example/existing'), permission: 'granted' });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('on'));
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    expect(result.current.state).toBe('denied');
  });

  it('does not let an old status check overwrite a completed disable', async () => {
    const existing = fakeSubscription('https://push.example/existing');
    const manager = browser({ existing, permission: 'granted' });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('on'));
    let finish!: (value: typeof existing) => void;
    manager.getSubscription.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => result.current.disable());
    await act(async () => finish(existing));
    expect(result.current.state).toBe('off');
  });

  it.each([
    ['permission', 'permission'], ['key', 'network'], ['subscribe', 'browser'], ['save', 'save'], ['auth', 'signin'],
  ])('reports %s failures without leaking raw errors', async (stage, expected) => {
    const manager = browser();
    const error = new Error('private endpoint should not be shown');
    if (stage === 'auth') error.name = 'NotSignedInError';
    const repo = repoWith();
    if (stage === 'permission') vi.mocked(Notification.requestPermission).mockRejectedValue(error);
    if (stage === 'key') vi.mocked(repo.pushPublicKey!).mockRejectedValue(error);
    if (stage === 'subscribe') manager.subscribe.mockRejectedValue(new DOMException('push provider failed', 'AbortError'));
    if (stage === 'save' || stage === 'auth') vi.mocked(repo.savePushSubscription!).mockRejectedValue(error);
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    await act(async () => { expect(await result.current.enable()).toBe(expected); });
    expect(result.current.busy).toBe(false);
    expect(result.current.state).toBe('off');
  });

  it('reuses the subscription after a failed save, without unsubscribing or duplicating it', async () => {
    const manager = browser();
    const save = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce('saved');
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith({ savePushSubscription: save })) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    await act(async () => { expect(await result.current.enable()).toBe('save'); });
    const subscription = await manager.getSubscription();
    expect(subscription?.unsubscribe).not.toHaveBeenCalled();
    await act(async () => { expect(await result.current.enable()).toBe('on'); });
    expect(manager.subscribe).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('renews a subscription only when its application server key changed', async () => {
    const existing = Object.assign(fakeSubscription('https://push.example/old'), { options: { applicationServerKey: new Uint8Array(65).buffer } });
    const manager = browser({ existing, permission: 'granted' });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('on'));
    await act(async () => { expect(await result.current.enable()).toBe('on'); });
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(manager.subscribe).toHaveBeenCalledOnce();
  });

  it('distinguishes a dismissed prompt from blocked permission', async () => {
    browser();
    vi.mocked(Notification.requestPermission).mockResolvedValue('default');
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    await act(async () => { expect(await result.current.enable()).toBe('dismissed'); });
    expect(result.current.state).toBe('off');
  });

  it('bounds the wait for a missing service worker', async () => {
    browser({ permission: 'granted' });
    vi.stubGlobal('navigator', { serviceWorker: { ready: new Promise(() => {}) } });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current?.state).toBe('checking'));
    vi.useFakeTimers();
    await act(async () => {
      const outcome = result.current.enable();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await outcome).toBe('worker');
    });
    expect(result.current.busy).toBe(false);
  });

  it('does not run duplicate subscriptions for repeated taps', async () => {
    const manager = browser();
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    await act(async () => {
      const first = result.current.enable();
      expect(await result.current.enable()).toBe('busy');
      expect(await first).toBe('on');
    });
    expect(manager.subscribe).toHaveBeenCalledOnce();
  });

  it('is unsupported where the browser has no push', async () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: undefined });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repoWith()) });
    await waitFor(() => expect(result.current?.state).toBe('unsupported'));
  });

  it('reads the device as off, subscribes with the server key on request, and saves the subscription', async () => {
    const pushManager = browser();
    const repo = repoWith();
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.state).toBe('off'));

    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.enable(); });
    expect(outcome).toBe('on');
    expect(result.current.state).toBe('on');
    const [options] = pushManager.subscribe.mock.calls[0] as unknown as [{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(options.applicationServerKey.length).toBe(65);
    expect(repo.savePushSubscription).toHaveBeenCalledWith({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } });
  });

  it('reports a device already subscribed as on, and turns it off on request', async () => {
    const existing = fakeSubscription('https://push.example/old');
    browser({ existing, permission: 'granted' });
    const repo = repoWith();
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.state).toBe('on'));
    await act(async () => { await result.current.disable(); });
    expect(repo.deletePushSubscription).toHaveBeenCalledWith('https://push.example/old');
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('off');
  });

  it('takes a fresh endpoint when the server says the device belongs to another account', async () => {
    const pushManager = browser();
    const save = vi.fn().mockResolvedValueOnce('conflict').mockResolvedValueOnce('saved');
    const repo = repoWith({ savePushSubscription: save });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    await act(async () => { await result.current.enable(); });
    expect(pushManager.subscribe).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ endpoint: 'https://push.example/2' });
    expect(result.current.state).toBe('on');
  });

  it('stops at a refused permission and says so', async () => {
    browser();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'denied') });
    const repo = repoWith();
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.enable(); });
    expect(outcome).toBe('denied');
    expect(result.current.state).toBe('denied');
    expect(repo.savePushSubscription).not.toHaveBeenCalled();
  });

  it('is unavailable when the server has no push configured', async () => {
    browser();
    const repo = repoWith({ pushPublicKey: vi.fn(async () => null) });
    const { result } = renderHook(() => usePushNotifications(), { wrapper: wrapper(repo) });
    await waitFor(() => expect(result.current.state).toBe('off'));
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.enable(); });
    expect(outcome).toBe('unavailable');
  });
});
