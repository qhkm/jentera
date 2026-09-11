import { useCallback, useEffect, useState } from 'react';
import { useRepository } from '@/lib/repo';
import type { PushSubscriptionJson, Repository } from '@/lib/repo';

export type PushState = 'unsupported' | 'checking' | 'off' | 'on' | 'denied';
export type EnableOutcome = 'on' | 'denied' | 'unavailable' | 'failed';

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
  const registration = await navigator.serviceWorker.ready;
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

  useEffect(() => {
    if (!pushSupported()) return;
    let live = true;
    currentSubscription()
      .then((subscription) => {
        if (!live) return;
        setState(subscription ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off');
      })
      .catch(() => { if (live) setState('off'); });
    return () => { live = false; };
  }, []);

  const enable = useCallback(async (): Promise<EnableOutcome> => {
    if (!pushSupported() || !repo.savePushSubscription || !repo.pushPublicKey) return 'unavailable';
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      setState(permission === 'denied' ? 'denied' : 'off');
      return 'denied';
    }
    const key = await repo.pushPublicKey().catch(() => null);
    if (!key) return 'unavailable';
    try {
      const registration = await navigator.serviceWorker.ready;
      const options: PushSubscriptionOptionsInit = { userVisibleOnly: true, applicationServerKey: applicationServerKey(key) };
      let subscription = await registration.pushManager.subscribe(options);
      let outcome = await repo.savePushSubscription(subscription.toJSON() as PushSubscriptionJson);
      if (outcome === 'conflict') {
        /* The same browser served another account before. Its endpoint is
           theirs; a fresh subscription gets this owner their own. */
        await subscription.unsubscribe();
        subscription = await registration.pushManager.subscribe(options);
        outcome = await repo.savePushSubscription(subscription.toJSON() as PushSubscriptionJson);
      }
      if (outcome !== 'saved') {
        await subscription.unsubscribe().catch(() => false);
        setState('off');
        return 'failed';
      }
      setState('on');
      return 'on';
    } catch {
      setState('off');
      return 'failed';
    }
  }, [repo]);

  const disable = useCallback(async () => {
    await disablePush(repo);
    setState('off');
  }, [repo]);

  return { state, enable, disable };
}
