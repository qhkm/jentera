import type postgres from 'postgres';
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { appsEnabledFor } from '../apps/gating';
import { ConfigError, parseConfigInput, publicBookingUrl, readConfig, saveConfig } from '../apps/bookings/config';
import { bookingJson, cancelBooking, decideBooking, decodeCursor, getBooking, listBookings, type BookingContext } from '../apps/bookings/bookings';
import { isDate, myDate } from '../apps/bookings/time';
import type { Lang } from '../apps/bookings/messages';

/* Business apps, owner side. Spec: docs/plans/2026-09-23-apps-shell-and-bookings-v1.md.
   Every path answers 404 unless the business is on the apps pilot list, so
   removing an id hides the feature at once. */

export function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers },
  });
}

export function originAllowed(request: Request, cors: Record<string, string>): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === cors['Access-Control-Allow-Origin'];
}

export function forbidden(cors: Record<string, string>) {
  return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
}

export function notFound(cors: Record<string, string>) {
  return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
}

export async function handleApps(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== '/api/apps' && !url.pathname.startsWith('/api/apps/')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  if (!appsEnabledFor(env, identity.businessId)) return notFound(cors);
  if (request.method !== 'GET' && !originAllowed(request, cors)) {
    return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
  }
  const businessId = identity.businessId;
  const sitesOrigin = env.SITES_ORIGIN ?? '';
  const now = new Date();

  if (url.pathname === '/api/apps' && request.method === 'GET') {
    if (!can(identity, 'apps.manage')) return forbidden(cors);
    const apps = await withTenant(env, businessId, async (tx) => {
      const [installed] = await tx<{ public_slug: string; state: 'active' | 'paused' }[]>`
        select public_slug, state from app_installation where business_id = ${businessId} and app_key = 'bookings'`;
      if (!installed) return [];
      const [{ pending }] = await tx<{ pending: number }[]>`
        select count(*)::int as pending from booking
         where business_id = ${businessId} and status = 'pending' and starts_at > ${now}`;
      return [{ key: 'bookings', state: installed.state, publicUrl: publicBookingUrl(sitesOrigin, installed.public_slug), pending }];
    });
    return json({ ok: true, apps, available: ['bookings'] }, {}, cors);
  }

  if (url.pathname === '/api/apps/bookings/config') {
    if (!can(identity, 'apps.manage')) return forbidden(cors);
    if (request.method === 'GET') {
      const config = await withTenant(env, businessId, (tx) => readConfig(tx, businessId, sitesOrigin));
      return json({ ok: true, config }, {}, cors);
    }
    if (request.method === 'PUT') {
      const parsed = parseConfigInput(await request.json().catch(() => null));
      if (!parsed.ok) return json({ ok: false, err: parsed.err }, { status: 400 }, cors);
      try {
        const config = await withTenant(env, businessId, async (tx) => {
          await saveConfig(tx, businessId, parsed.value, now);
          return readConfig(tx, businessId, sitesOrigin);
        });
        return json({ ok: true, config }, {}, cors);
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        return json({ ok: false, code: error.code, serviceId: error.serviceId },
          { status: error.code === 'ACK_REQUIRED' ? 400 : 409 }, cors);
      }
    }
  }

  if (url.pathname === '/api/apps/bookings/bookings' || url.pathname.startsWith('/api/apps/bookings/bookings/')) {
    if (!can(identity, 'bookings.decide')) return forbidden(cors);
    const context = async (tx: postgres.TransactionSql): Promise<BookingContext | null> => {
      const [business] = await tx<{ name: string; lang: Lang }[]>`select name, lang from business where id = ${businessId}`;
      const [installed] = await tx<{ public_slug: string }[]>`select public_slug from app_installation
        where business_id = ${businessId} and app_key = 'bookings'`;
      if (!business || !installed) return null;
      return { businessName: business.name, lang: business.lang, publicUrl: publicBookingUrl(sitesOrigin, installed.public_slug), now };
    };

    if (url.pathname === '/api/apps/bookings/bookings' && request.method === 'GET') {
      const from = url.searchParams.get('from') ?? myDate(now);
      const days = Number(url.searchParams.get('days') ?? '7');
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const status = url.searchParams.get('status');
      const rawCursor = url.searchParams.get('cursor');
      const cursor = rawCursor ? decodeCursor(rawCursor) : null;
      if (!isDate(from) || !Number.isInteger(days) || days < 1 || days > 31 || !Number.isInteger(limit) || limit < 1 ||
          limit > 100 || (status !== null && status !== 'pending') || (rawCursor && !cursor)) {
        return json({ ok: false, err: 'invalid bookings window' }, { status: 400 }, cors);
      }
      const result = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        if (!ctx) return null;
        const page = await listBookings(tx, businessId, { from, days, status: status === 'pending' ? 'pending' : null, cursor, limit, now });
        return { bookings: page.rows.map((row) => bookingJson(row, ctx)), nextCursor: page.nextCursor };
      });
      if (!result) return notFound(cors);
      return json({ ok: true, ...result }, {}, cors);
    }

    const match = url.pathname.match(/^\/api\/apps\/bookings\/bookings\/([0-9a-f-]{36})(?:\/(decide|cancel))?$/i);
    if (!match) return notFound(cors);
    const [, id, action] = match;

    if (!action && request.method === 'GET') {
      const found = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        const row = ctx ? await getBooking(tx, businessId, id) : null;
        return ctx && row ? bookingJson(row, ctx) : null;
      });
      return found ? json({ ok: true, booking: found }, {}, cors) : notFound(cors);
    }

    if (action && request.method === 'POST') {
      let decision: 'confirm' | 'decline' | null = null;
      if (action === 'decide') {
        const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
        decision = body?.decision === 'confirm' || body?.decision === 'decline' ? body.decision : null;
        if (!decision) return json({ ok: false, err: 'decision must be confirm or decline' }, { status: 400 }, cors);
      }
      const outcome = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        if (!ctx) return { ok: false as const, code: 'NOT_FOUND' as const };
        const result = decision
          ? await decideBooking(tx, businessId, id, decision, identity.userId, now)
          : await cancelBooking(tx, businessId, id, identity.userId, now);
        return result.ok ? { ok: true as const, booking: bookingJson(result.row, ctx) } : result;
      });
      if (!outcome.ok) {
        return outcome.code === 'NOT_FOUND' ? notFound(cors)
          : json({ ok: false, code: outcome.code }, { status: 409 }, cors);
      }
      return json({ ok: true, booking: outcome.booking, whatsappUrl: outcome.booking.whatsappUrl }, {}, cors);
    }
  }

  return notFound(cors);
}
