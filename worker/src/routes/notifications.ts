import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import {
  decodeNotificationCursor,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationJson,
  unreadNotificationCount,
} from '../notifications/store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers },
  });
}

export async function handleNotifications(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== '/api/notifications' && !url.pathname.startsWith('/api/notifications/')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }

  if (url.pathname === '/api/notifications' && request.method === 'GET') {
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 30 : Number(rawLimit);
    const rawCursor = url.searchParams.get('cursor');
    const cursor = rawCursor ? decodeNotificationCursor(rawCursor) : null;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (rawCursor && !cursor)) {
      return json({ ok: false, err: 'invalid notification page' }, { status: 400 }, cors);
    }
    const result = await withTenant(env, identity.businessId, async (tx) => {
      const page = await listNotifications(tx, identity.userId, limit, cursor);
      return {
        notifications: page.rows.map(notificationJson),
        nextCursor: page.nextCursor,
        unread: await unreadNotificationCount(tx, identity.userId),
      };
    });
    return json({ ok: true, apiVersion: 1, ...result }, {}, cors);
  }

  if (url.pathname === '/api/notifications/read-all' && request.method === 'POST') {
    const updated = await withTenant(env, identity.businessId, (tx) =>
      markAllNotificationsRead(tx, identity.userId));
    return json({ ok: true, apiVersion: 1, updated }, {}, cors);
  }

  const match = url.pathname.match(/^\/api\/notifications\/([0-9a-f-]{36})\/read$/i);
  if (match && UUID.test(match[1]) && request.method === 'POST') {
    const updated = await withTenant(env, identity.businessId, (tx) =>
      markNotificationRead(tx, identity.userId, match[1]));
    if (!updated) return json({ ok: false, err: 'notification not found' }, { status: 404 }, cors);
    return json({ ok: true, apiVersion: 1 }, {}, cors);
  }

  return json({ ok: false, err: 'notification not found' }, { status: 404 }, cors);
}
