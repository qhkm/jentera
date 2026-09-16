import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* API is read once at module load, so the module is imported per test with
   the environment already stubbed rather than stubbed after the fact. */
async function resumeNativeSignIn(): Promise<string | null> {
  return (await import('..')).resumeNativeSignIn();
}

const STATE = 'a'.repeat(20);
const VERIFIER = 'v'.repeat(43);
const CODE = 'c'.repeat(43);
const LINK = `https://jentera.ai/app-auth?code=${CODE}&state=${STATE}`;
const SCHEME = `ai.jentera.app://auth?code=${CODE}&state=${STATE}`;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', 'https://api.test');
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Capacitor');
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A native bridge holding one pending sign-in attempt and one launch URL. */
function bridge(launchUrl: string, attempt: string | null = JSON.stringify({ state: STATE, codeVerifier: VERIFIER })) {
  localStorage.setItem('jentera-native-install-v1', '1');
  const values = new Map<string, string>();
  if (attempt) values.set('jentera.native-auth-attempt', attempt);
  Object.assign(globalThis, {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: { getLaunchUrl: vi.fn(async () => ({ url: launchUrl })) },
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
  return values;
}

describe('native sign-in callback', () => {
  it('exchanges the verified App Link', async () => {
    const values = bridge(LINK);
    const request = vi.fn().mockResolvedValue(Response.json({ token: 'native-token', next: '/app' }));
    vi.stubGlobal('fetch', request);

    await expect(resumeNativeSignIn()).resolves.toBe('/app');
    expect(values.get('jentera.session')).toBe('native-token');
    /* The verifier never leaves the device until the code comes back, and
       the state it was stored against has to match. */
    const body = JSON.parse((request.mock.calls[0][1] as RequestInit).body as string) as Record<string, string>;
    expect(body).toEqual({ code: CODE, state: STATE, codeVerifier: VERIFIER });
    /* A used attempt is not left behind for a second callback to replay. */
    expect(values.has('jentera.native-auth-attempt')).toBe(false);
  });

  it('still accepts the legacy custom scheme, for an iOS build that needs it', async () => {
    const values = bridge(SCHEME);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ token: 'scheme-token', next: '/app' })));

    await expect(resumeNativeSignIn()).resolves.toBe('/app');
    expect(values.get('jentera.session')).toBe('scheme-token');
  });

  it.each([
    ['another path on the same site', `https://jentera.ai/app?code=${CODE}&state=${STATE}`],
    ['a lookalike host', `https://jentera.ai.example.com/app-auth?code=${CODE}&state=${STATE}`],
    ['plain http', `http://jentera.ai/app-auth?code=${CODE}&state=${STATE}`],
  ])('ignores %s', async (_name, url) => {
    bridge(url);
    const request = vi.fn();
    vi.stubGlobal('fetch', request);

    await expect(resumeNativeSignIn()).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a callback whose state this app did not start', async () => {
    bridge(`https://jentera.ai/app-auth?code=${CODE}&state=${'z'.repeat(20)}`);
    const request = vi.fn();
    vi.stubGlobal('fetch', request);

    await expect(resumeNativeSignIn()).rejects.toThrow(/not started by this app/);
    expect(request).not.toHaveBeenCalled();
  });
});
