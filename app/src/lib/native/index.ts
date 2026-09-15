/**
 * The boundary between the shared React app and Capacitor.
 *
 * Platform detection and native credentials stay here. The rest of the app
 * asks for an Authorization header and never knows whether the token came
 * from iOS Keychain or Android's Keystore-backed encrypted preferences.
 */

type NativePlatform = 'ios' | 'android' | 'native' | 'web';

interface PluginListenerHandle {
  remove: () => Promise<void>;
}

interface AppPlugin {
  addListener: (
    event: 'appUrlOpen' | 'appRestoredResult',
    listener: (event: { url?: string }) => void,
  ) => Promise<PluginListenerHandle>;
  getLaunchUrl: () => Promise<{ url: string } | undefined>;
}

interface BrowserPlugin {
  open: (options: { url: string; toolbarColor?: string }) => Promise<void>;
  close: () => Promise<void>;
  addListener: (
    event: 'browserFinished',
    listener: () => void,
  ) => Promise<PluginListenerHandle>;
}

interface SecureStoragePlugin {
  internalGetItem: (options: {
    prefixedKey: string;
    sync: boolean;
  }) => Promise<{ data: string | null }>;
  internalSetItem: (options: {
    prefixedKey: string;
    data: string;
    sync: boolean;
    access: number;
  }) => Promise<void>;
  internalRemoveItem: (options: {
    prefixedKey: string;
    sync: boolean;
  }) => Promise<{ success: boolean }>;
}

interface NativePlugins {
  App?: AppPlugin;
  Browser?: BrowserPlugin;
  SecureStorage?: SecureStoragePlugin;
}

interface CapacitorBridge {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: NativePlugins;
}

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const WEB_SIGN_IN = 'https://jentera.ai/signin';
const CALLBACK_SCHEME = 'ai.jentera.app:';
const CALLBACK_HOST = 'auth';
const SESSION_KEY = 'jentera.session';
const ATTEMPT_KEY = 'jentera.native-auth-attempt';
const INSTALL_MARKER = 'jentera-native-install-v1';
const VALID_CODE = /^[A-Za-z0-9_-]{43}$/;
const VALID_PKCE = /^[A-Za-z0-9._~-]{43,128}$/;
const VALID_STATE = /^[A-Za-z0-9._~-]{16,128}$/;
const SAFE_NEXT = new Set(['/onboard', '/setup', '/app', '/access']);

interface NativeAuthAttempt {
  state: string;
  codeVerifier: string;
}

function bridge(): CapacitorBridge | undefined {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorBridge }).Capacitor;
}

function plugins(): NativePlugins {
  return bridge()?.Plugins ?? {};
}

export function nativePlatform(): NativePlatform {
  const capacitor = bridge();
  if (!capacitor?.isNativePlatform?.()) return 'web';
  const platform = capacitor.getPlatform?.();
  return platform === 'ios' || platform === 'android' ? platform : 'native';
}

export function isNative(): boolean {
  return nativePlatform() !== 'web';
}

export class NativeCapabilityUnavailableError extends Error {
  constructor(capability: string) {
    super(`${capability} is not wired into this native build`);
    this.name = 'NativeCapabilityUnavailableError';
  }
}

function unavailable(capability: string): never {
  throw new NativeCapabilityUnavailableError(capability);
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomValue(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )));
}

function storagePlugin(): SecureStoragePlugin {
  return plugins().SecureStorage ?? unavailable('Secure storage');
}

async function removeStored(key: string): Promise<void> {
  await storagePlugin().internalRemoveItem({ prefixedKey: key, sync: false });
}

let preparedStorage: Promise<void> | null = null;

async function prepareStorage(): Promise<void> {
  if (!isNative()) return;
  if (!preparedStorage) preparedStorage = (async () => {
    /* Keychain survives uninstall on iOS while WebView storage does not. A
       missing local marker therefore means a fresh install: remove any old
       session before it can silently sign a new installation in. */
    if (globalThis.localStorage?.getItem(INSTALL_MARKER) !== '1') {
      await Promise.all([
        removeStored(SESSION_KEY),
        removeStored(ATTEMPT_KEY),
      ]);
      globalThis.localStorage?.setItem(INSTALL_MARKER, '1');
    }
  })();
  await preparedStorage;
}

export const secureStore = {
  async get(key: string): Promise<string | null> {
    if (!isNative()) return null;
    await prepareStorage();
    return (await storagePlugin().internalGetItem({
      prefixedKey: key,
      sync: false,
    })).data;
  },
  async set(key: string, value: string): Promise<void> {
    if (!isNative()) return;
    await prepareStorage();
    await storagePlugin().internalSetItem({
      prefixedKey: key,
      data: value,
      sync: false,
      /* accessibleWhenUnlockedThisDeviceOnly: no iCloud or backup migration. */
      access: 1,
    });
  },
  async remove(key: string): Promise<void> {
    if (!isNative()) return;
    await prepareStorage();
    await removeStored(key);
  },
};

export async function nativeSessionToken(): Promise<string | null> {
  return secureStore.get(SESSION_KEY);
}

export async function nativeAuthorizationHeaders(): Promise<Record<string, string>> {
  const token = await nativeSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseAttempt(raw: string | null): NativeAuthAttempt | null {
  try {
    const value = JSON.parse(raw ?? '') as Partial<NativeAuthAttempt>;
    return typeof value.state === 'string' && VALID_STATE.test(value.state) &&
      typeof value.codeVerifier === 'string' && VALID_PKCE.test(value.codeVerifier)
      ? { state: value.state, codeVerifier: value.codeVerifier }
      : null;
  } catch {
    return null;
  }
}

async function exchangeCallback(callback: string): Promise<string> {
  const url = new URL(callback);
  if (url.protocol !== CALLBACK_SCHEME || url.hostname !== CALLBACK_HOST) {
    throw new Error('Jentera received an invalid sign-in callback.');
  }
  const code = url.searchParams.get('code') ?? '';
  const returnedState = url.searchParams.get('state') ?? '';
  if (!VALID_CODE.test(code) || !VALID_STATE.test(returnedState)) {
    throw new Error('Jentera received an incomplete sign-in callback.');
  }
  const attempt = parseAttempt(await secureStore.get(ATTEMPT_KEY));
  if (!attempt || attempt.state !== returnedState) {
    throw new Error('This sign-in was not started by this app. Please try again.');
  }
  if (!API) throw new Error('Jentera authentication is not configured.');

  const response = await fetch(`${API}/api/auth/native/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      state: returnedState,
      codeVerifier: attempt.codeVerifier,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: unknown;
    next?: unknown;
    err?: unknown;
  };
  if (!response.ok || typeof body.token !== 'string' || !body.token) {
    throw new Error(typeof body.err === 'string' ? body.err : 'Sign-in could not be completed.');
  }
  await secureStore.set(SESSION_KEY, body.token);
  await secureStore.remove(ATTEMPT_KEY);
  return typeof body.next === 'string' && SAFE_NEXT.has(body.next) ? body.next : '/app';
}

/** Complete a deep link that launched a fresh app process. */
export async function resumeNativeSignIn(): Promise<string | null> {
  if (!isNative() || await nativeSessionToken()) return null;
  const app = plugins().App;
  if (!app) return unavailable('Native sign-in');
  const launch = await app.getLaunchUrl();
  return launch?.url?.startsWith(`${CALLBACK_SCHEME}//${CALLBACK_HOST}`)
    ? exchangeCallback(launch.url)
    : null;
}

let activeSignIn: Promise<string | null> | null = null;

/** Open the real Jentera sign-in page in the system browser. */
export async function signIn(): Promise<string | null> {
  if (!isNative()) return null;
  if (activeSignIn) return activeSignIn;
  const app = plugins().App;
  const browser = plugins().Browser;
  if (!app || !browser) return unavailable('Native sign-in');

  activeSignIn = (async () => {
    const state = randomValue();
    const codeVerifier = randomValue();
    const codeChallenge = await challengeFor(codeVerifier);
    await secureStore.set(ATTEMPT_KEY, JSON.stringify({ state, codeVerifier }));
    const url = new URL(WEB_SIGN_IN);
    url.search = new URLSearchParams({
      native: '1',
      state,
      code_challenge: codeChallenge,
    }).toString();

    return new Promise<string | null>(async (resolve, reject) => {
      let settled = false;
      let opened: PluginListenerHandle | null = null;
      let finished: PluginListenerHandle | null = null;
      const clean = async () => {
        await Promise.all([
          opened?.remove().catch(() => undefined),
          finished?.remove().catch(() => undefined),
        ]);
      };
      const done = async (result: string | null, error?: unknown) => {
        if (settled) return;
        settled = true;
        await clean();
        if (error) reject(error);
        else resolve(result);
      };
      try {
        opened = await app.addListener('appUrlOpen', (event) => {
          if (!event.url?.startsWith(`${CALLBACK_SCHEME}//${CALLBACK_HOST}`)) return;
          void exchangeCallback(event.url)
            .then(async (next) => {
              await browser.close().catch(() => undefined);
              await done(next);
            })
            .catch((error) => done(null, error));
        });
        finished = await browser.addListener('browserFinished', () => {
          void done(null);
        });
        await browser.open({ url: url.toString(), toolbarColor: '#242c29' });
      } catch (error) {
        await done(null, error);
      }
    });
  })().finally(() => {
    activeSignIn = null;
  });
  return activeSignIn;
}

/** Mint the one-time callback from an authenticated system browser page. */
export async function handoffBrowserSession(input: {
  state: string;
  codeChallenge: string;
}): Promise<boolean> {
  if (!VALID_STATE.test(input.state) || !VALID_PKCE.test(input.codeChallenge) || !API) {
    return false;
  }
  const response = await fetch(`${API}/api/auth/native/code`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 401) return false;
  const body = (await response.json().catch(() => ({}))) as { code?: unknown; err?: unknown };
  if (!response.ok || typeof body.code !== 'string' || !VALID_CODE.test(body.code)) {
    throw new Error(typeof body.err === 'string' ? body.err : 'Could not return to the Jentera app.');
  }
  window.location.assign(
    `${CALLBACK_SCHEME}//${CALLBACK_HOST}?${new URLSearchParams({
      code: body.code,
      state: input.state,
    })}`,
  );
  return true;
}

/** Revoke the server session when online, then always remove the local token. */
export async function signOutNative(): Promise<void> {
  if (!isNative()) return;
  const token = await nativeSessionToken();
  try {
    if (token && API) await fetch(`${API}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } finally {
    await secureStore.remove(SESSION_KEY);
  }
}

/** Registers APNs/FCM only after a signed-in owner requests notifications. */
export async function registerForPush(): Promise<string | null> {
  if (!isNative()) return null;
  return unavailable('Native push');
}

/** Returns a downscaled document photograph once the camera slice lands. */
export async function capturePhoto(): Promise<File | null> {
  if (!isNative()) return null;
  return unavailable('Document camera');
}

/** Fetches, stores and hands an authenticated artifact to the share sheet. */
export async function openArtifact(_url: string): Promise<boolean> {
  if (!isNative()) return false;
  return unavailable('Native artifact opening');
}
