import type { Env } from '../env';
import { withTenant } from '../db';
import { encryptPayload, vapidAuthorization, vapidKeysFromJwk } from './crypto';
import {
  forgetPushSubscriptions,
  listPushSubscriptions,
  touchPushSubscriptions,
  type PushSubscriptionRow,
} from './subscriptions';

/** What the service worker shows. `url` is where a tap lands, within the app. */
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  /** Same tag: the newer notification replaces the older on the device. */
  tag?: string;
}

/** What the sender needs from fetch; the harness's fake fits it too. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response;

export interface PushResult {
  sent: number;
  /** Subscriptions the push service reported gone, now deleted. */
  removed: number;
  failed: number;
}

/** A day: long enough to survive a phone that is off overnight. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PRIVATE_JWK?.trim() && env.VAPID_SUBJECT?.trim());
}

/**
 * Send one notification to every device this owner subscribed. Never
 * throws: a push is a courtesy, and the work that triggered it must not
 * fail because a push service was down. Devices the service says are gone
 * (404, 410) are forgotten so nothing keeps trying.
 */
export async function pushToUser(
  env: Env,
  businessId: string,
  userId: string,
  payload: PushPayload,
  options: { fetch?: FetchLike } = {},
): Promise<PushResult> {
  const result: PushResult = { sent: 0, removed: 0, failed: 0 };
  if (!pushConfigured(env)) return result;
  const subscriptions = await withTenant(env, businessId, (tx) => listPushSubscriptions(tx, businessId, userId));
  if (subscriptions.length === 0) return result;

  const keys = await vapidKeysFromJwk(env.VAPID_PRIVATE_JWK!);
  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/app',
    ...(payload.tag ? { tag: payload.tag } : {}),
  });
  const fetchImpl: FetchLike = options.fetch ?? fetch;
  const outcomes = await Promise.all(subscriptions.map(async (subscription) => {
    try {
      const status = await deliver(fetchImpl, keys, env.VAPID_SUBJECT!, subscription, message);
      if (status === 404 || status === 410) return 'gone' as const;
      return status >= 200 && status < 300 ? 'sent' as const : 'failed' as const;
    } catch {
      return 'failed' as const;
    }
  }));

  const sent = subscriptions.filter((_, i) => outcomes[i] === 'sent').map((s) => s.id);
  const gone = subscriptions.filter((_, i) => outcomes[i] === 'gone').map((s) => s.id);
  result.sent = sent.length;
  result.removed = gone.length;
  result.failed = outcomes.filter((o) => o === 'failed').length;
  if (sent.length || gone.length) {
    await withTenant(env, businessId, async (tx) => {
      await touchPushSubscriptions(tx, businessId, sent);
      await forgetPushSubscriptions(tx, businessId, gone);
    }).catch((error: unknown) => {
      console.warn('push bookkeeping failed', error instanceof Error ? error.message : String(error));
    });
  }
  return result;
}

async function deliver(
  fetchImpl: FetchLike,
  keys: Awaited<ReturnType<typeof vapidKeysFromJwk>>,
  subject: string,
  subscription: PushSubscriptionRow,
  message: string,
): Promise<number> {
  const body = await encryptPayload(message, subscription);
  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(PUSH_TTL_SECONDS),
      Urgency: 'normal',
      Authorization: await vapidAuthorization(keys, subscription.endpoint, subject),
    },
    body,
  });
  return response.status;
}
