import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { appsEnabledFor } from '../apps/gating';
import { ConfigError, parseConfigInput, publicBookingUrl, readConfig, saveConfig } from '../apps/bookings/config';

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

  return notFound(cors);
}
