import type { Env } from '../env';
import { withTenant } from '../db';
import { getRuntimeAccess } from '../agent-runtime';
import { hasBusiness, resolveTenant } from '../tenancy';

const ACTIONS = new Set(['claim', 'release', 'frame', 'navigate', 'click', 'text', 'key', 'scroll', 'tab']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGES: Record<string, string> = {
  runtime_busy: 'Jentera is still working. Let the current task finish, then take control.',
  browser_busy: 'The browser is handling another action. Try again.',
  browser_controlled: 'Another window is controlling this browser. Hand back there or wait for its control to expire.',
  browser_control_expired: 'Your browser control expired. Take control again to continue or hand back.',
  invalid_url: 'Enter a public HTTPS website address.',
};

/** Deliberately not a generic proxy. Identity selects both the business and
 * its sealed runner key. Never accept an origin, owner id, CDP URL or token
 * from the browser. Screens and input are ephemeral and must not be logged. */
export async function handleBrowser(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  if (url.pathname !== '/api/browser') return null;
  const headers = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (!['GET', 'POST'].includes(request.method)) return json({ err: 'method not allowed' }, 405);
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ err: 'not signed in' }, 401);
  if (!hasBusiness(identity)) return json({ err: 'no business' }, 404);
  if (identity.role !== 'owner') return json({ err: 'owner access required' }, 403);
  let command: Record<string, unknown> | undefined;
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (!origin || !env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin)) {
      return json({ err: 'origin not allowed' }, 403);
    }
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ err: 'JSON required' }, 415);
    try {
      const raw = await request.text();
      if (raw.length > 12000) return json({ err: 'command too large' }, 413);
      const body = JSON.parse(raw);
      if (!body || !ACTIONS.has(body.action) || !UUID.test(body.controlId ?? '')) return json({ err: 'invalid command' }, 400);
      command = { action: body.action, controlId: body.controlId, ownerId: identity.userId, businessId: identity.businessId };
      for (const field of ['url', 'x', 'y', 'text', 'key', 'deltaY', 'index']) {
        if (body[field] !== undefined) command[field] = body[field];
      }
    } catch { return json({ err: 'invalid command' }, 400); }
  }
  try {
    const { runtime, secrets } = await withTenant(env, identity.businessId, (tx) => getRuntimeAccess(env, tx, identity.businessId));
    if (!runtime.providerUrl || runtime.provider !== 'fly-sprite' || !env.SPRITES_TOKEN ||
        !['ready', 'cold', 'idle', 'busy'].includes(runtime.status)) return json({ err: 'Business browser is not ready yet.' }, 503);
    const endpoint = new URL('/v1/browser', runtime.providerUrl);
    if (endpoint.protocol !== 'https:') return json({ err: 'Business browser is unavailable.' }, 503);
    const upstream = await fetch(endpoint, {
      method: request.method, redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: { 'X-Aisar-Runner-Key': secrets.runnerKey, Authorization: `Bearer ${env.SPRITES_TOKEN}`,
        'Content-Type': 'application/json' },
      ...(command ? { body: JSON.stringify(command) } : {}),
    });
    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({})) as { error?: string };
      const code = typeof body.error === 'string' && Object.hasOwn(MESSAGES, body.error)
        ? body.error : 'browser_unavailable';
      return json({ err: MESSAGES[code] ?? 'Business browser is unavailable. Try again shortly.', code },
        [400, 409].includes(upstream.status) ? upstream.status : 503);
    }
    // The private runner returns only its narrow browser DTO. Do not relay
    // upstream headers, Set-Cookie, server errors or arbitrary proxy content.
    const body = await upstream.json() as Record<string, unknown>;
    return json(Object.fromEntries(['enabled', 'paused', 'controlled', 'expiresAt', 'image', 'width', 'height', 'tabs', 'ok']
      .filter((key) => body[key] !== undefined).map((key) => [key, body[key]])));
  } catch { return json({ err: 'Business browser is unavailable. Try again shortly.' }, 503); }
}
