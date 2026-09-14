import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';

const EVENTS = new Set([
  'signup_started',
  'signin_started',
  'onboarding_started',
  'business_import_started',
  'business_profile_confirmed',
  'onboarding_completed',
  'dashboard_opened',
  'ask_sent',
  'ask_completed',
  'work_sent',
  'work_completed',
  'telegram_connect_started',
  'telegram_connected',
  'installed_app_opened',
]);

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTES = new Set(['/', '/signin', '/onboard', '/setup', '/app']);

export async function handleEvents(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== '/api/events') return null;
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: cors });
  }

  const body = (await request.json().catch(() => null)) as {
    event?: unknown;
    sessionId?: unknown;
    route?: unknown;
    elapsedSeconds?: unknown;
  } | null;
  if (!body || typeof body.event !== 'string' || !EVENTS.has(body.event) ||
      typeof body.sessionId !== 'string' || !SESSION.test(body.sessionId) ||
      typeof body.route !== 'string' || !ROUTES.has(body.route) ||
      typeof body.elapsedSeconds !== 'number' || !Number.isFinite(body.elapsedSeconds)) {
    return new Response(JSON.stringify({ ok: false, err: 'invalid event' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  if (body.event === 'installed_app_opened') {
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim());
    if (!allowed.includes(request.headers.get('Origin') ?? '')) {
      return new Response(JSON.stringify({ ok: false, err: 'untrusted event origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
  }

  /* The dataset receives only an allow-listed event, a random browser id,
     a coarse route, and time since that browser's activation session began. */
  env.PRODUCT_ANALYTICS?.writeDataPoint({
    indexes: [body.sessionId],
    blobs: [body.event, body.route],
    doubles: [Math.max(0, Math.min(30 * 24 * 60 * 60, body.elapsedSeconds))],
  });

  /* This is the only launch milestone browsers cannot reconstruct from
     existing server state. Record it only for a real signed-in tenant and
     only from an allowed first-party origin. Repeated app opens update the
     freshness timestamp without changing the original conversion time. */
  if (body.event === 'installed_app_opened') {
    const identity = await resolveTenant(env, request);
    if (hasBusiness(identity)) {
      await withTenant(env, identity.businessId, (tx) => tx`
        insert into activation_milestone (business_id, user_id, kind)
        values (${identity.businessId}, ${identity.userId}, 'installed_app_opened')
        on conflict (business_id, user_id, kind) do update set last_seen_at = now()`);
    }
  }
  return new Response(null, { status: 204, headers: cors });
}
