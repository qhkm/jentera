import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeCapabilityUnavailableError,
  capturePhoto,
  isNative,
  nativePlatform,
  openArtifact,
  registerForPush,
  secureStore,
  signIn,
} from '..';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Capacitor');
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

  it('refuses to pretend unfinished native capabilities work', async () => {
    Object.assign(globalThis, {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
    });
    await expect(signIn()).rejects.toBeInstanceOf(NativeCapabilityUnavailableError);
    await expect(secureStore.set('session', 'secret')).rejects.toBeInstanceOf(NativeCapabilityUnavailableError);
  });
});
