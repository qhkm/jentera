import { readCookie } from './auth';
import type { Env } from './env';
import { clientIp } from './ratelimit';

/** API payloads in this product are small JSON commands. Files belong in
    object storage, not in a Worker request that will be buffered and parsed. */
export const MAX_API_BODY_BYTES = 128 * 1024;

const text = new TextEncoder();

async function opaqueKey(env: Env, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    text.encode(env.RATE_LIMIT_PEPPER ?? 'aisar-local-dev-pepper'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, text.encode(value));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function response(
  status: number,
  err: string,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ ok: false, err }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cors,
      ...extra,
    },
  });
}

function requestIdentity(request: Request, url: URL): string {
  const hook = url.pathname.match(
    /^\/api\/webhooks\/telegram\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i,
  );
  if (hook) return `telegram:${hook[1]}:${hook[2]}`;

  /* A session token is stable across NAT changes and avoids making an office
     share one quota. It is only a rate-limit key here; authentication still
     happens in the route and no unverified claim is trusted. */
  const session = readCookie(request);
  if (session) return `session:${session}`;
  return `ip:${clientIp(request)}`;
}

/**
 * Cheap, pre-route protection for every API request.
 *
 * This deliberately runs before session verification, Neon, email, queues,
 * or provider calls. The binding is a per-colo burst brake rather than an
 * exact global quota; account and spend limits still belong in durable state.
 */
export async function guardApiRequest(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/')) return null;

  if (!['GET', 'POST', 'DELETE', 'HEAD'].includes(request.method)) {
    return response(405, 'method not allowed', cors, { Allow: 'GET, POST, DELETE, HEAD, OPTIONS' });
  }

  if (url.pathname.length + url.search.length > 8_192) {
    return response(414, 'request target too long', cors);
  }

  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0 || length > MAX_API_BODY_BYTES) {
      return response(413, 'request body too large', cors);
    }
  }

  const identity = requestIdentity(request, url);
  try {
    const key = await opaqueKey(env, `api:${identity}`);
    const general = await env.API_BURST.limit({ key });
    if (!general.success) {
      console.warn(`[request-guard] api burst refused path=${url.pathname} ray=${request.headers.get('CF-Ray') ?? 'none'}`);
      return response(429, 'too many requests', cors, { 'Retry-After': '60' });
    }

    if (url.pathname === '/api/runtime/provision' && request.method === 'POST') {
      /* Provisioning is rare and expensive. Check both the session-shaped
         identity and the source address so rotating fake cookies cannot buy
         unlimited provider API calls before authentication rejects them. */
      const [byIdentity, byIp] = await Promise.all([
        opaqueKey(env, `runtime:${identity}`).then((runtimeKey) =>
          env.RUNTIME_MUTATION_BURST.limit({ key: runtimeKey })),
        opaqueKey(env, `runtime-ip:${clientIp(request)}`).then((ipKey) =>
          env.RUNTIME_MUTATION_BURST.limit({ key: ipKey })),
      ]);
      if (!byIdentity.success || !byIp.success) {
        console.warn(`[request-guard] runtime mutation refused ray=${request.headers.get('CF-Ray') ?? 'none'}`);
        return response(429, 'too many runtime requests', cors, { 'Retry-After': '60' });
      }
    }
  } catch (error) {
    /* A broken protection binding must not silently turn an expensive route
       into an unprotected one. Returning 503 also avoids touching Neon. */
    console.error(`[request-guard] limiter unavailable: ${String(error)}`);
    return response(503, 'request protection unavailable', cors, { 'Retry-After': '60' });
  }

  return null;
}
