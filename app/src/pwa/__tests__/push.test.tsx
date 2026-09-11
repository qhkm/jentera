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
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: Promise.resolve(registration) } });
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

afterEach(() => vi.unstubAllGlobals());

describe('usePushNotifications', () => {
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
