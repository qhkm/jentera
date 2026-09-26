import type postgres from 'postgres';
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { appsEnabledFor } from '../apps/gating';
import { ConfigError, parseConfigInput, publicBookingUrl, readConfig, saveConfig } from '../apps/bookings/config';
import {
  bookingJson, cancelBooking, decideBooking, decodeCursor, getBooking, listBookings, retryCalendar,
  type BookingContext, type DecideResult,
} from '../apps/bookings/bookings';
import { runCalendarJob } from '../apps/bookings/calendar-sync';
import { isDate, myDate } from '../apps/bookings/time';
import type { Lang } from '../apps/bookings/messages';
import { refreshBookingCalendarAvailability } from '../apps/bookings/calendar-availability';

/** Today plus the longest booking horizon (90 days), counting today as day 0. */
const PENDING_WINDOW_DAYS = 91;
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
] as const);

async function readLogo(request: Request): Promise<Uint8Array | null> {
  if (!request.body || Number(request.headers.get('Content-Length')) > LOGO_MAX_BYTES) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LOGO_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  if (size === 0) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function matchesLogoType(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/png') {
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);
  }
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return contentType === 'image/webp' && bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
}

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
  execution?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response | null> {
  if (url.pathname !== '/api/apps' && !url.pathname.startsWith('/api/apps/')) return null;
  /* Server-Timing, so an owner's DevTools can split a slow request between
     signing in and the route's own work (Date.now advances across I/O, which
     is what these are). */
  const started = Date.now();
  const identity = await resolveTenant(env, request);
  const auth = Date.now() - started;
  const response = await appsRoute(request, env, url, cors, identity, execution);
  const timed = new Response(response.body, response);
  timed.headers.set('Server-Timing', `auth;dur=${auth}, route;dur=${Date.now() - started - auth}`);
  if (cors['Access-Control-Allow-Origin']) timed.headers.set('Timing-Allow-Origin', cors['Access-Control-Allow-Origin']);
  return timed;
}

async function appsRoute(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  identity: Awaited<ReturnType<typeof resolveTenant>>,
  execution?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
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
      // The owner's own switch (Taking bookings) lives here, not in `state`,
      // which only an operator changes. Read as the public page reads it: no
      // row is not accepting (apps/bookings/public.ts, request.ts).
      const [settings] = await tx<{ accepting: boolean }[]>`
        select accepting from booking_settings where business_id = ${businessId}`;
      const [{ pending }] = await tx<{ pending: number }[]>`
        select count(*)::int as pending from booking
         where business_id = ${businessId} and status = 'pending' and starts_at > ${now}`;
      return [{
        key: 'bookings', state: installed.state, accepting: settings?.accepting ?? false,
        publicUrl: publicBookingUrl(sitesOrigin, installed.public_slug), pending,
      }];
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

  if (url.pathname === '/api/apps/bookings/logo') {
    if (!can(identity, 'apps.manage')) return forbidden(cors);
    if (!env.ARTIFACTS) return json({ ok: false, err: 'logo storage unavailable' }, { status: 503 }, cors);
    if (request.method === 'PUT') {
      const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
      const extension = LOGO_TYPES.get(contentType as 'image/png' | 'image/jpeg' | 'image/webp');
      if (!extension) return json({ ok: false, err: 'logo must be PNG, JPEG or WebP' }, { status: 415 }, cors);
      const bytes = await readLogo(request);
      if (!bytes) return json({ ok: false, err: 'logo must be between 1 byte and 1 MB' }, { status: 413 }, cors);
      if (!matchesLogoType(bytes, contentType)) return json({ ok: false, err: 'logo file does not match its image type' }, { status: 400 }, cors);
      const key = `bookings/${businessId}/branding/${crypto.randomUUID()}.${extension}`;
      await env.ARTIFACTS.put(key, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } });
      try {
        const result = await withTenant(env, businessId, async (tx) => {
          const [current] = await tx<{ logo_key: string | null }[]>`
            select logo_key from booking_settings where business_id = ${businessId} for update`;
          if (!current) return null;
          await tx`update booking_settings set logo_key = ${key}, logo_content_type = ${contentType}, logo_updated_at = ${now}, updated_at = ${now}
            where business_id = ${businessId}`;
          await tx`update app_installation set config_version = config_version + 1, updated_at = ${now}
            where business_id = ${businessId} and app_key = 'bookings'`;
          return { oldKey: current.logo_key, config: await readConfig(tx, businessId, sitesOrigin) };
        });
        if (!result) {
          await env.ARTIFACTS.delete(key);
          return notFound(cors);
        }
        if (result.oldKey && result.oldKey !== key) {
          const remove = env.ARTIFACTS.delete(result.oldKey).catch(() => {});
          execution?.waitUntil(remove);
          if (!execution) await remove;
        }
        return json({ ok: true, config: result.config }, {}, cors);
      } catch (error) {
        await env.ARTIFACTS.delete(key).catch(() => {});
        throw error;
      }
    }
    if (request.method === 'DELETE') {
      const result = await withTenant(env, businessId, async (tx) => {
        const [current] = await tx<{ logo_key: string | null }[]>`
          select logo_key from booking_settings where business_id = ${businessId} for update`;
        if (!current) return null;
        if (current.logo_key) {
          await tx`update booking_settings set logo_key = null, logo_content_type = null, logo_updated_at = null, updated_at = ${now}
            where business_id = ${businessId}`;
          await tx`update app_installation set config_version = config_version + 1, updated_at = ${now}
            where business_id = ${businessId} and app_key = 'bookings'`;
        }
        return { oldKey: current.logo_key, config: await readConfig(tx, businessId, sitesOrigin) };
      });
      if (!result) return notFound(cors);
      if (result.oldKey) {
        const remove = env.ARTIFACTS.delete(result.oldKey).catch(() => {});
        execution?.waitUntil(remove);
        if (!execution) await remove;
      }
      return json({ ok: true, config: result.config }, {}, cors);
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
      /* Waiting requests span the whole booking horizon, and the app wants
         them in one request rather than three 31-day windows in parallel. */
      const maxDays = status === 'pending' ? PENDING_WINDOW_DAYS : 31;
      if (!isDate(from) || !Number.isInteger(days) || days < 1 || days > maxDays || !Number.isInteger(limit) || limit < 1 ||
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

    const match = url.pathname.match(/^\/api\/apps\/bookings\/bookings\/([0-9a-f-]{36})(?:\/(decide|cancel|calendar\/retry))?$/i);
    if (!match) return notFound(cors);
    const [, id, rawAction] = match;
    // The pattern is case-insensitive, so dispatch on one spelling, by name.
    const action = rawAction?.toLowerCase();

    if (!action && request.method === 'GET') {
      const found = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        const row = ctx ? await getBooking(tx, businessId, id) : null;
        return ctx && row ? bookingJson(row, ctx) : null;
      });
      return found ? json({ ok: true, booking: found }, {}, cors) : notFound(cors);
    }

    if (action && request.method === 'POST') {
      // One named action each; anything else is not a route.
      let run: (tx: postgres.TransactionSql) => Promise<DecideResult>;
      if (action === 'decide') {
        const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
        const decision = body?.decision === 'confirm' || body?.decision === 'decline' ? body.decision : null;
        if (!decision) return json({ ok: false, err: 'decision must be confirm or decline' }, { status: 400 }, cors);
        if (decision === 'confirm') {
          // Only a still-pending request can become confirmed. This avoids
          // contacting Google for a 404 or an idempotent second click; the
          // locked decision below remains the authority if state races.
          const pending = await withTenant(env, businessId, async (tx) => {
            const [row] = await tx`select 1 from booking
              where business_id = ${businessId} and id = ${id} and status = 'pending'`;
            return Boolean(row);
          });
          if (pending) {
            const availability = await refreshBookingCalendarAvailability(env, businessId, { now, force: true });
            if (availability === 'error') {
              return json({ ok: false, code: 'CALENDAR_CHECK_UNAVAILABLE' }, { status: 503 }, cors);
            }
          }
        }
        run = (tx) => decideBooking(tx, businessId, id, decision, identity.userId, now);
      } else if (action === 'cancel') {
        run = (tx) => cancelBooking(tx, businessId, id, identity.userId, now);
      } else if (action === 'calendar/retry') {
        run = (tx) => retryCalendar(tx, businessId, id, now);
      } else {
        return notFound(cors);
      }
      const outcome = await withTenant(env, businessId, async (tx) => {
        const ctx = await context(tx);
        if (!ctx) return { ok: false as const, code: 'NOT_FOUND' as const };
        const result = await run(tx);
        return result.ok
          ? { ok: true as const, booking: bookingJson(result.row, ctx), calendarQueued: result.calendarQueued }
          : result;
      });
      if (!outcome.ok) {
        return outcome.code === 'NOT_FOUND' ? notFound(cors)
          : json({ ok: false, code: outcome.code }, { status: 409 }, cors);
      }
      /* The transaction has committed: start the first Calendar attempt now,
         in this invocation near the database, without holding the answer for
         it. The minute cron is the backstop if this never runs. */
      if (outcome.calendarQueued) execution?.waitUntil(runCalendarJob(env, businessId, id));
      return json({
        ok: true, booking: outcome.booking, whatsappUrl: outcome.booking.whatsappUrl, calendarQueued: outcome.calendarQueued,
      }, {}, cors);
    }
  }

  return notFound(cors);
}
