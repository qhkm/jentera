import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-token',
  keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
};

describe('RemoteRepository web push', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads the VAPID public key, and reports none when push is not configured', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, key: 'BPUBLIC' }))
      .mockResolvedValueOnce(response({ ok: false, err: 'push notifications are not configured' }, 503));
    vi.stubGlobal('fetch', fetch);
    const repo = new RemoteRepository();
    await expect(repo.pushPublicKey()).resolves.toBe('BPUBLIC');
    await expect(repo.pushPublicKey()).resolves.toBeNull();
    expect(String(fetch.mock.calls[0][0])).toBe('/api/push/vapid-public-key');
  });

  it('saves the browser subscription with the session, and names a device another account holds', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ ok: false, err: 'this device is registered to another account' }, 409));
    vi.stubGlobal('fetch', fetch);
    const repo = new RemoteRepository();
    await expect(repo.savePushSubscription(SUBSCRIPTION)).resolves.toBe('saved');
    const [path, init] = fetch.mock.calls[0];
    expect(String(path)).toBe('/api/push/subscription');
    expect(init?.method).toBe('PUT');
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(String(init?.body))).toEqual(SUBSCRIPTION);
    await expect(repo.savePushSubscription(SUBSCRIPTION)).resolves.toBe('conflict');
  });

  it('removes a device by its endpoint', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await new RemoteRepository().deletePushSubscription(SUBSCRIPTION.endpoint);
    const [path, init] = fetch.mock.calls[0];
    expect(String(path)).toBe('/api/push/subscription');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ endpoint: SUBSCRIPTION.endpoint });
  });
});
