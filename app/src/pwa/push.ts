import { useCallback, useEffect, useRef, useState } from 'react';
import { useRepository } from '@/lib/repo';
import type { PushSubscriptionJson, Repository } from '@/lib/repo';

export type PushState = 'unsupported' | 'checking' | 'off' | 'on' | 'denied';
export type EnableOutcome = 'on' | 'denied' | 'unavailable' | 'failed' | 'dismissed' | 'permission' | 'worker' | 'network' | 'browser' | 'save' | 'signin' | 'busy';

async function readyWorker(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worker not ready')), 10_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Push needs a service worker, the Push API and the Notification API.
    iPhone Safari has them only once the app is on the home screen. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' &&
    Boolean(navigator.serviceWorker) && 'PushManager' in window && 'Notification' in window;
}

function applicationServerKey(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await readyWorker();
  return registration.pushManager.getSubscription();
}

/** Drop this browser's subscription on the server and in the browser.
    Called at sign-out too, so the next account on a shared device does
    not receive the previous owner's notifications. Never throws. */
export async function disablePush(repo: Repository): Promise<void> {
  if (!pushSupported()) return;
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await repo.deletePushSubscription?.(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    /* A browser that lost its worker has nothing to unsubscribe. */
  }
}

/**
 * The switch behind "Notifications on this device": whether this browser
 * can receive push at all, whether it currently does, and the two moves.
 * Enabling asks the browser's permission (which must follow a tap), then
 * subscribes with the server's VAPID key and hands the subscription over.
 */
export function usePushNotifications() {
  const repo = useRepository();
  const [state, setState] = useState<PushState>(() => (pushSupported() ? 'checking' : 'unsupported'));
  const working = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    let live = true;
    currentSubscription()
      .then((subscription) => {
        if (!live || working.current) return;
        setState(subscription ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off');
      })
      .catch(() => { if (live) setState('off'); });
    return () => { live = false; };
  }, []);

  const enable = useCallback(async (): Promise<EnableOutcome> => {
    if (working.current) return 'busy';
    if (!pushSupported() || !repo.savePushSubscription || !repo.pushPublicKey) return 'unavailable';
    working.current = true;
    setBusy(true);
    let stage: EnableOutcome = 'permission';
    try {
      // Keep the permission request in the original tap, before any network awaits.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return permission === 'denied' ? 'denied' : 'dismissed';
      }
      stage = 'network';
      const key = await repo.pushPublicKey();
      if (!key) return 'unavailable';
      stage = 'unavailable';
      const decoded = applicationServerKey(key);
      if (decoded.length !== 65 || decoded[0] !== 4) return 'unavailable';
      stage = 'worker';
      const registration = await readyWorker();
      stage = 'browser';
      const options: PushSubscriptionOptionsInit = { userVisibleOnly: true, applicationServerKey: decoded };
      let subscription = await registration.pushManager.getSubscription();
      const oldKey = subscription?.options?.applicationServerKey;
      // Only replace an existing subscription when its signing key demonstrably changed.
      if (subscription && oldKey && (oldKey.byteLength !== decoded.length || new Uint8Array(oldKey).some((byte, i) => byte !== decoded[i]))) {
        if (!await subscription.unsubscribe()) return 'browser';
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe(options);
      stage = 'save';
      let outcome = await repo.savePushSubscription(subscription.toJSON() as PushSubscriptionJson);
      if (outcome === 'conflict') {
        /* The same browser served another account before. Its endpoint is
           theirs; a fresh subscription gets this owner their own. */
        stage = 'browser';
        if (!await subscription.unsubscribe()) return 'browser';
        subscription = await registration.pushManager.subscribe(options);
        stage = 'save';
        outcome = await repo.savePushSubscription(subscription.toJSON() as PushSubscriptionJson);
      }
      if (outcome !== 'saved') {
        await subscription.unsubscribe().catch(() => false);
        setState('off');
        return 'failed';
      }
      setState('on');
      return 'on';
    } catch (error) {
      setState('off');
      if (error instanceof Error && error.name === 'NotSignedInError') return 'signin';
      if (Notification.permission === 'denied') {
        setState('denied');
        return 'denied';
      }
      return stage;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [repo]);

  const disable = useCallback(async () => {
    await disablePush(repo);
    setState('off');
  }, [repo]);

  return { state, busy, enable, disable };
}
