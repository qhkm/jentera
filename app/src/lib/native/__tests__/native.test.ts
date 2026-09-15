import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeCapabilityUnavailableError,
  capturePhoto,
  isNative,
  nativeAuthorizationHeaders,
  nativePlatform,
  openArtifact,
  registerForPush,
  secureStore,
  signIn,
} from '..';
import { RemoteRepository } from '@/lib/repo/remote';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Capacitor');
  localStorage.removeItem('jentera-native-install-v1');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native boundary', () => {
  it('is a harmless no-op throughout the web app', async () => {
    expect(isNative()).toBe(false);
    expect(nativePlatform()).toBe('web');
    await expect(signIn()).resolves.toBeNull();
    await expect(registerForPush()).resolves.toBeNull();
    await expect(capturePhoto()).resolves.toBeNull();
    await expect(openArtifact('/api/artifacts/a1')).resolves.toBe(false);
    await expect(secureStore.get('session')).resolves.toBeNull();
    await expect(secureStore.set('session', 'secret')).resolves.toBeUndefined();
    await expect(secureStore.remove('session')).resolves.toBeUndefined();
  });

  it.each(['ios', 'android'] as const)('recognises the %s bridge without user-agent guessing', (platform) => {
    Object.assign(globalThis, {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => platform },
    });
    expect(isNative()).toBe(true);
    expect(nativePlatform()).toBe(platform);
  });

  it('keeps the bearer in the native secure-storage plugin', async () => {
    localStorage.setItem('jentera-native-install-v1', '1');
    const values = new Map<string, string>();
    Object.assign(globalThis, {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: {
          SecureStorage: {
            internalGetItem: vi.fn(async ({ prefixedKey }: { prefixedKey: string }) => ({
              data: values.get(prefixedKey) ?? null,
            })),
            internalSetItem: vi.fn(async ({ prefixedKey, data }: { prefixedKey: string; data: string }) => {
              values.set(prefixedKey, data);
            }),
            internalRemoveItem: vi.fn(async ({ prefixedKey }: { prefixedKey: string }) => ({
              success: values.delete(prefixedKey),
            })),
          },
        },
      },
    });

    await secureStore.set('jentera.session', 'native-secret');
    await expect(secureStore.get('jentera.session')).resolves.toBe('native-secret');
    await expect(nativeAuthorizationHeaders()).resolves.toEqual({
      Authorization: 'Bearer native-secret',
    });
    expect(localStorage.getItem('native-secret')).toBeNull();
  });

  it('adds the stored bearer to repository requests', async () => {
    localStorage.setItem('jentera-native-install-v1', '1');
    const values = new Map([['jentera.session', 'repository-session']]);
    Object.assign(globalThis, {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          SecureStorage: {
            internalGetItem: vi.fn(async ({ prefixedKey }: { prefixedKey: string }) => ({
              data: values.get(prefixedKey) ?? null,
            })),
            internalSetItem: vi.fn(async () => undefined),
            internalRemoveItem: vi.fn(async () => ({ success: true })),
          },
        },
      },
    });
    const request = vi.fn().mockResolvedValue(Response.json({ detailLevel: 'beginner' }));
    vi.stubGlobal('fetch', request);

    await expect(new RemoteRepository().detailLevel()).resolves.toBe('beginner');
    const headers = new Headers((request.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer repository-session');
    expect((request.mock.calls[0][1] as RequestInit).credentials).toBe('include');
  });

  it('refuses to pretend unfinished native capabilities work', async () => {
    Object.assign(globalThis, {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
    });
    await expect(signIn()).rejects.toBeInstanceOf(NativeCapabilityUnavailableError);
    await expect(secureStore.set('session', 'secret')).rejects.toBeInstanceOf(NativeCapabilityUnavailableError);
  });
});
