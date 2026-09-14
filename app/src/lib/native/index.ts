/**
 * The boundary between the shared React app and Capacitor.
 *
 * Keep platform detection here so web code never guesses from a user agent.
 * Feature methods are deliberately harmless on the web and fail loudly in a
 * native shell until their security-sensitive implementations land.
 */

type NativePlatform = 'ios' | 'android' | 'native' | 'web';

interface CapacitorBridge {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
}

function bridge(): CapacitorBridge | undefined {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorBridge }).Capacitor;
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

/** Opens native authentication once the PKCE worker routes exist. */
export async function signIn(): Promise<string | null> {
  if (!isNative()) return null;
  return unavailable('Native sign-in');
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

export const secureStore = {
  async get(_key: string): Promise<string | null> {
    if (!isNative()) return null;
    return unavailable('Secure storage');
  },
  async set(_key: string, _value: string): Promise<void> {
    if (isNative()) unavailable('Secure storage');
  },
  async remove(_key: string): Promise<void> {
    if (isNative()) unavailable('Secure storage');
  },
};
