/* ============================================================
   Web push subscriptions.

   GET  /api/push/vapid-public-key   the key a browser subscribes with
   PUT  /api/push/subscription       { endpoint, keys: { p256dh, auth } }
   DELETE /api/push/subscription     { endpoint }

   A subscription belongs to the signed-in owner of the tenant that
   resolved from the session, never to anything in the body. Saving one
   sends a first push straight back, so the owner sees the device work
   before any routine has anything to say.
   ============================================================ */
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { b64urlDecode, vapidKeysFromJwk } from '../push/crypto';
import { pushConfigured, pushToUser, type FetchLike } from '../push/send';
import {
  deletePushSubscription,
  savePushSubscription,
  UNIQUE_VIOLATION,
} from '../push/subscriptions';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

function endpointOf(body: Record<string, unknown> | null): string | null {
  const value = body?.endpoint;
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** The browser's keys, as a push service issued them: an uncompressed
    P-256 point and a 16-byte secret, base64url. Normalised to unpadded. */
function keysOf(body: Record<string, unknown> | null): { p256dh: string; auth: string } | null {
  const keys = body?.keys;
  if (!keys || typeof keys !== 'object') return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  const strip = (value: string) => value.replace(/=+$/, '');
  try {
    const point = b64urlDecode(p256dh);
    const secret = b64urlDecode(auth);
    if (point.length !== 65 || point[0] !== 4 || secret.length !== 16) return null;
  } catch {
    return null;
  }
  return { p256dh: strip(p256dh), auth: strip(auth) };
}

export async function handlePush(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  deps: { ctx?: ExecutionContext; fetch?: FetchLike } = {},
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/push/')) return null;

  if (url.pathname === '/api/push/vapid-public-key' && request.method === 'GET') {
    if (!pushConfigured(env)) {
      return json({ ok: false, err: 'push notifications are not configured' }, { status: 503 }, cors);
    }
    const keys = await vapidKeysFromJwk(env.VAPID_PRIVATE_JWK!);
    return json({ ok: true, key: keys.publicKey }, {}, cors);
  }

  if (url.pathname === '/api/push/subscription' && (request.method === 'PUT' || request.method === 'DELETE')) {
    const identity = await resolveTenant(env, request);
    if (!hasBusiness(identity)) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const endpoint = endpointOf(body);
    if (!endpoint) return json({ ok: false, err: 'endpoint must be an https URL' }, { status: 400 }, cors);
    const { businessId, userId } = identity;

    if (request.method === 'DELETE') {
      await withTenant(env, businessId, (tx) => deletePushSubscription(tx, businessId, userId, endpoint));
      return json({ ok: true }, {}, cors);
    }

    const keys = keysOf(body);
    if (!keys) return json({ ok: false, err: 'keys must carry the browser p256dh point and auth secret' }, { status: 400 }, cors);
    if (!pushConfigured(env)) {
      return json({ ok: false, err: 'push notifications are not configured' }, { status: 503 }, cors);
    }
    try {
      await withTenant(env, businessId, (tx) => savePushSubscription(tx, businessId, userId, {
        endpoint, ...keys, userAgent: request.headers.get('User-Agent'),
      }));
    } catch (error) {
      /* The same browser, another account: RLS hid the earlier row and the
         insert collided with it. The browser drops this subscription and
         takes a fresh endpoint rather than inheriting someone else's. */
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        return json({ ok: false, err: 'this device is registered to another account' }, { status: 409 }, cors);
      }
      throw error;
    }

    const welcome = pushToUser(env, businessId, userId, {
      title: 'Jentera',
      body: 'Notifications are on for this device. · Notifikasi dihidupkan untuk peranti ini.',
      url: '/app?view=notifications',
      tag: 'jentera-welcome',
    }, { fetch: deps.fetch }).catch(() => undefined);
    if (deps.ctx) deps.ctx.waitUntil(welcome);
    else await welcome;
    return json({ ok: true }, {}, cors);
  }

  return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
}
