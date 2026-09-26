import { COOKIE_NAME, readSessionToken } from './auth';
import type { Env } from './env';
import { clientIp } from './ratelimit';
import { ASK_FILE_PATH, INGEST_FILE_PATH, UPLOAD_DOCUMENT_LIMIT } from './routes/runs';

/** API payloads are small JSON commands except on the two explicitly bounded
    file routes below. */
export const MAX_API_BODY_BYTES = 128 * 1024;

/** The exceptions: documents uploaded to Knowledge or attached to chat. Derived from
    the route's own ceiling (routes/runs.ts), not restated, so the two can
    never drift apart the way they did until 14 September: the guard must
    never refuse a body the route would accept, or the route's limit is
    unreachable no matter what it is set to. The 64 KiB of headroom exists
    so the guard practically never trips first — the route still enforces
    the same ceiling and returns its own, more specific message ("a file is
    at most N bytes") instead of the guard's generic "request body too
    large". */
export const MAX_UPLOAD_BODY_BYTES = UPLOAD_DOCUMENT_LIMIT + 64 * 1024;

/** The workspace origins, as `ALLOWED_ORIGINS` lists them; CORS reads the same list. */
export function allowedOrigins(env: Pick<Env, 'ALLOWED_ORIGINS'>): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/* The public booking pages are on book.jentera.ai, the same site as this API,
   so SameSite=Lax no longer keeps the session cookie off a write sent from
   them. A browser always names the page a cross-origin write comes from; a
   write carrying the session cookie from anywhere but the workspace is
   refused. A bearer token is never attached by a browser on its own, and a
   request with no Origin is not a browser's. */
const WRITES = new Set(['POST', 'PUT', 'DELETE']);

function crossSiteCookieWrite(request: Request, env: Env): boolean {
  if (!WRITES.has(request.method)) return false;
  const origin = request.headers.get('Origin');
  if (origin === null || request.headers.get('Authorization') !== null) return false;
  const cookies = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim());
  if (!cookies.some((part) => part.startsWith(`${COOKIE_NAME}=`))) return false;
  return !allowedOrigins(env).includes(origin);
}

function bodyCapFor(method: string, pathname: string): number {
  return method === 'POST' && [INGEST_FILE_PATH, ASK_FILE_PATH].includes(pathname)
    ? MAX_UPLOAD_BODY_BYTES
    : MAX_API_BODY_BYTES;
}

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

/** Fail-closed admission for authenticated external events that can buy model
    tokens. Callers provide stable, non-secret tenant/channel identities. */
export async function admitPaidAgentRun(env: Env, identities: string[]): Promise<boolean> {
  if (identities.length === 0 || identities.length > 3) return false;
  try {
    const verdicts = await Promise.all(identities.map((identity) =>
      opaqueKey(env, `agent-run:${identity}`).then((key) =>
        env.AGENT_RUN_BURST.limit({ key }))));
    return verdicts.every((verdict) => verdict.success);
  } catch {
    console.error('[request-guard] authenticated agent limiter unavailable');
    return false;
  }
}

/** Whether this album item may speak. Telegram sends an album as one webhook
    per item, so without this five receipts draw five identical "can't open
    photos" replies. Approximate, like any edge limiter, and it fails open:
    an outage costs duplicate replies, never silence. */
export async function claimTelegramAlbumReply(
  env: Env,
  connectionId: string,
  albumId: string,
): Promise<boolean> {
  try {
    const key = await opaqueKey(env, `telegram-album:${connectionId}:${albumId}`);
    return (await env.TELEGRAM_ALBUM_REPLY.limit({ key })).success;
  } catch {
    return true;
  }
}

/** Whether this voice note may speak: its echo or its one-line reply. The
    inline slice and the queued safety net can both hear a note long enough to
    outlast the 30 s delay between them; one of them answers. Shares the album
    limiter (one per key per 60 s) under its own key prefix. Fails open. */
export async function claimTelegramVoiceReply(
  env: Env,
  connectionId: string,
  chatId: number,
  messageId: number,
): Promise<boolean> {
  try {
    const key = await opaqueKey(env, `telegram-voice:${connectionId}:${chatId}:${messageId}`);
    return (await env.TELEGRAM_ALBUM_REPLY.limit({ key })).success;
  } catch {
    return true;
  }
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
  const session = readSessionToken(request);
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
  if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(request.method)) {
    return response(405, 'method not allowed', cors, { Allow: 'GET, POST, PUT, DELETE, HEAD, OPTIONS' });
  }

  if (url.pathname.length + url.search.length > 8_192) {
    return response(414, 'request target too long', cors);
  }

  if (crossSiteCookieWrite(request, env)) return response(403, 'request from an unknown page', cors);

  const cap = bodyCapFor(request.method, url.pathname);
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isFinite(length) || length < 0 || length > cap) {
      return response(413, 'request body too large', cors);
    }
  } else if (request.body !== null) {
    /* No Content-Length (e.g. Transfer-Encoding: chunked) bypassed the
       check above. Measure the real body through a clone — reading the
       clone leaves the original intact for the route — and refuse
       anything over the cap. A bounded read also prevents a slow trickle
       from pinning the isolate forever; the stream only makes progress
       while we pull. */
    const probe = request.clone();
    try {
      // The enclosing else-if already proved request.body !== null, so the
      // clone's stream exists.
      const reader = probe.body!.getReader();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > cap) break;
        }
      }
      if (total > cap) {
        /* This is a hard rejection: the request never reaches a route.
           Do not await cancel on the clone/tee'd body — under Node/undici
           (as in this test suite), cancelling a partially-read clone never
           settles, which caused a 30-second hang. Under workerd the same
           cancel settles immediately (measured September 2026), so the
           non-awaited cancel is a test-environment defence, not a production
           fix. Release the reader without blocking. */
        reader.cancel().catch(() => {});
        return response(413, 'request body too large', cors);
      }
    } catch {
      /* Unreadable body — hand it to the route, whose JSON parse will
         fail loudly rather than accept garbage. */
    }
  }

  const identity = requestIdentity(request, url);
  const runtimeMutation = isRuntimeMutation(request.method, url.pathname);
  const agentRun = request.method === 'POST' && (
    ['/api/runs/ask', ASK_FILE_PATH, '/api/runs/ingest', INGEST_FILE_PATH].includes(url.pathname) ||
    /* An approval decision resumes a paid agent run, which is what this
       brake is for. It must not share the 3/60s runtime-mutation bucket:
       an owner who denies one approval and approves the next would be
       refused for doing exactly what the surface asks of them. */
    /^\/api\/runtime\/approvals\/[0-9a-f-]{36}\/decide$/i.test(url.pathname));
  const runStream = request.method === 'GET' &&
    (/^\/api\/runs\/[0-9a-f-]{36}\/events$/i.test(url.pathname) ||
      url.pathname === '/api/browser/desktop' || url.pathname === '/api/browser/observe');
  try {
    /* The cookie is not authenticated yet, so it cannot be the only key: a
       bot could rotate fake cookie values. The source-address brake remains
       stable across those rotations. */
    const [byIdentity, byIp] = await Promise.all([
      opaqueKey(env, `api:${identity}`).then((key) => env.API_BURST.limit({ key })),
      opaqueKey(env, `api-ip:${clientIp(request)}`).then((key) => env.API_BURST.limit({ key })),
    ]);
    if (!byIdentity.success || !byIp.success) {
      console.warn(`[request-guard] api burst refused path=${url.pathname} ray=${request.headers.get('CF-Ray') ?? 'none'}`);
      return response(429, 'too many requests', cors, { 'Retry-After': '60' });
    }
  } catch (error) {
    /* The broad limiter is defence in depth behind the zone WAF. Ordinary
       reads and health checks remain available during a binding outage. */
    console.error(`[request-guard] general limiter unavailable: ${String(error)}`);
  }

  if (runtimeMutation) {
    try {
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
    } catch (error) {
      /* Expensive provider mutations remain fail-closed even if their
         dedicated limiter binding is unavailable. */
      console.error(`[request-guard] runtime limiter unavailable: ${String(error)}`);
      return response(503, 'request protection unavailable', cors, { 'Retry-After': '60' });
    }
  }

  if (agentRun) {
    try {
      const [byIdentity, byIp] = await Promise.all([
        opaqueKey(env, `agent-run:${identity}`).then((key) =>
          env.AGENT_RUN_BURST.limit({ key })),
        opaqueKey(env, `agent-run-ip:${clientIp(request)}`).then((key) =>
          env.AGENT_RUN_BURST.limit({ key })),
      ]);
      if (!byIdentity.success || !byIp.success) {
        console.warn(`[request-guard] agent run refused ray=${request.headers.get('CF-Ray') ?? 'none'}`);
        return response(429, 'too many agent requests', cors, { 'Retry-After': '60' });
      }
    } catch (error) {
      /* Model/runtime admission is a spend boundary, so it has the same
         fail-closed posture as provider lifecycle mutations. */
      console.error(`[request-guard] agent limiter unavailable: ${String(error)}`);
      return response(503, 'request protection unavailable', cors, { 'Retry-After': '60' });
    }
  }

  if (runStream) {
    try {
      const [byIdentity, byIp] = await Promise.all([
        opaqueKey(env, `run-stream:${identity}`).then((key) =>
          env.RUN_STREAM_BURST.limit({ key })),
        opaqueKey(env, `run-stream-ip:${clientIp(request)}`).then((key) =>
          env.RUN_STREAM_BURST.limit({ key })),
      ]);
      if (!byIdentity.success || !byIp.success) {
        console.warn(`[request-guard] run stream refused ray=${request.headers.get('CF-Ray') ?? 'none'}`);
        return response(429, 'too many stream connections', cors, { 'Retry-After': '60' });
      }
    } catch {
      /* A limiter outage cannot be allowed to create unbounded long-lived sockets. */
      console.error('[request-guard] run stream limiter unavailable');
      return response(503, 'request protection unavailable', cors, { 'Retry-After': '60' });
    }
  }

  return null;
}

function isRuntimeMutation(method: string, path: string): boolean {
  if (method === 'DELETE' && path === '/api/runtime') return true;
  if (method !== 'POST') return false;
  return [
    '/api/runtime/provision',
    '/api/runtime/reconcile',
    '/api/runtime/upgrade',
    '/api/state/onboarding/complete',
  ]
    .includes(path) || /^\/api\/runtime\/tasks\/[0-9a-f-]{36}\/cancel$/i.test(path);
}
