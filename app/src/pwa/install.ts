import { useCallback, useSyncExternalStore } from 'react';

/** Chromium's `beforeinstallprompt`: held back and shown on request. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/* The browser fires `beforeinstallprompt` once, early, often before React
   has mounted anything. Keeping it at module level means the menu can offer
   the install whenever it opens, not only if it happened to be listening. */
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Running from the home screen already, on any platform. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone and iPad, where no browser ever fires `beforeinstallprompt`. */
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent ?? '')) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * What the account menu needs to offer "Install Jentera": whether the
 * browser will show its own prompt, whether an iPhone owner needs pointing
 * at Share → Add to Home Screen instead, and whether the app is already
 * installed and the item should stay hidden.
 */
export function usePwaInstall() {
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const standalone = isStandalone();
  const canPrompt = prompt !== null && !standalone;
  const iosHint = !canPrompt && !standalone && isIos();

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const event = deferred;
    if (!event) return 'unavailable';
    await event.prompt();
    const { outcome } = await event.userChoice;
    /* Chromium lets a prompt be shown once; either way it is spent. */
    deferred = null;
    notify();
    return outcome;
  }, []);

  return { canPrompt, iosHint, standalone, promptInstall };
}
