/* ============================================================
   Model proxy — the runtime-facing model endpoint.

   Runtimes are provisioned with MODEL_BASE = <this worker's
   origin>/v1/model and a derived `sk-jentera-v1.…` credential, so
   every model call lands here, is verified and metered, and is then
   forwarded to the configured upstream gateway with FMCV_UPSTREAM_KEY.
   The upstream (and its credential) is pure configuration — the
   gateway can be replaced without touching this route.

   Mounted before request-guard.ts on purpose: chat bodies and SSE
   responses are bigger than the API body cap, and the frontend
   cookie/identity machinery does not apply.

   Metering note: non-streaming completions meter exactly from the
   response `usage`. Streaming responses meter best-effort from the
   final usage chunk (`stream_options.include_usage` is injected when
   absent) — if the upstream never emits one, that request is not
   metered. The $5 rider ceiling is a backstop, not billing-grade.
   ============================================================ */

import type { Env } from '../env';
import {
  JenteraKeyError,
  JenteraKeyUnavailableError,
  RUNTIME_PROXY_PATH,
  recordRiderSpend,
  riderBudgetStatus,
  riderMonthKey,
  verifyJenteraKey,
  type JenteraKeyClaims,
} from '../fmcv-verifier';
import { modelCostMicrousd } from '../runtime/usage';
import { runtimeModelBaseAllowed } from '../runtime/execution';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RELAY_BODY_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000;
/** 1 USD-cent = 10,000 micro-USD. */
const MICROUSD_PER_CENT = 10_000;

export interface ModelProxyOptions {
  /** Injectable for tests; defaults to globalThis.fetch. */
  upstreamFetch?: typeof globalThis.fetch;
  /** Keeps the metering write alive after the streamed response ends. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function handleModelProxy(
  request: Request,
  env: Env,
  url: URL,
  headers: Record<string, string>,
  options: ModelProxyOptions = {},
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== RUNTIME_PROXY_PATH && !path.startsWith(`${RUNTIME_PROXY_PATH}/`)) {
    return null;
  }
  const tail = path.slice(RUNTIME_PROXY_PATH.length);
  if (tail !== '' && tail !== '/models' && tail !== '/chat/completions') {
    return jsonError(404, 'model proxy path is not supported', headers);
  }

  const token = bearerToken(request);
  let claims: JenteraKeyClaims;
  try {
    claims = await verifyJenteraKey(token, env.AISAR_MODEL_KEY?.trim() ?? '');
  } catch (err) {
    if (err instanceof JenteraKeyUnavailableError) {
      return jsonError(503, 'model control secret is not configured', headers);
    }
    if (err instanceof JenteraKeyError) {
      return jsonError(401, 'model credential is invalid', headers);
    }
    throw err;
  }

  if (tail === '/models' || tail === '') {
    if (request.method !== 'GET') return jsonError(405, 'models only supports GET', headers);
    return relayRaw(request, env, tail === '' ? '/models' : tail, headers, options);
  }
  if (request.method !== 'POST') {
    return jsonError(405, 'chat completions only supports POST', headers);
  }

  /* Admission: the signed ceiling inside the credential, checked against
     the spend ledger. Read-before-write, so concurrent completions can
     overshoot by the cost of in-flight requests; bounded and acceptable. */
  const budget = await riderBudgetStatus(env, claims.rid, new Date());
  if (!budget.allowed) {
    return jsonError(429, 'monthly model budget exhausted', headers, 429, 'budget_exceeded');
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, 'model request body is too large', headers);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'model request body is not valid JSON', headers);
  }
  if (typeof parsed.model !== 'string' || !parsed.model) {
    return jsonError(400, 'model request body has no model', headers);
  }
  /* Ask the upstream for the usage chunk so streaming requests can still be
     metered. Harmless where the upstream ignores it. */
  const wantsStream = parsed.stream === true;
  if (wantsStream) {
    const existing = parsed.stream_options;
    const includeUsage = existing && typeof existing === 'object'
      ? (existing as { include_usage?: unknown }).include_usage === true
      : false;
    if (!includeUsage) {
      const base = existing && typeof existing === 'object' ? existing : {};
      parsed.stream_options = { ...(base as object), include_usage: true };
    }
  }

  const upstreamCredential = env.FMCV_UPSTREAM_KEY?.trim() ?? '';
  if (!upstreamCredential || !runtimeModelBaseAllowed(env.AISAR_MODEL_BASE)) {
    return jsonError(503, 'model upstream is not configured', headers);
  }
  const upstream = upstreamUrl(env, '/chat/completions');
  const fetcher = options.upstreamFetch ?? ((input, init) => globalThis.fetch(input, init));

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetcher(upstream, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstreamCredential}`,
        'Content-Type': 'application/json',
        Accept: request.headers.get('Accept') ?? 'application/json',
        'User-Agent': 'Jentera-Model-Proxy/1',
      },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return jsonError(502, 'model upstream is unreachable', headers);
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  if (!upstreamResponse.ok) {
    return relayResponse(upstreamResponse, headers);
  }
  if (wantsStream) {
    const body = upstreamResponse.body;
    if (body && !upstreamResponse.headers.get('content-encoding')
        && contentType.includes('text/event-stream')) {
      const metered = body.pipeThrough(meteringStream(
        claims, String(parsed.model), env, options.waitUntil,
      ));
      return new Response(metered, {
        status: upstreamResponse.status,
        headers: { ...headers, ...relayHeaders(upstreamResponse.headers) },
      });
    }
    return new Response(body, {
      status: upstreamResponse.status,
      headers: { ...headers, ...relayHeaders(upstreamResponse.headers) },
    });
  }

  const text = await upstreamResponse.text();
  if (text.length > MAX_RELAY_BODY_BYTES) {
    return jsonError(502, 'model response is too large', headers);
  }
  let usage: Record<string, unknown> | null = null;
  try {
    const body = JSON.parse(text) as { usage?: unknown };
    usage = body.usage && typeof body.usage === 'object'
      ? body.usage as Record<string, unknown> : null;
  } catch {
    /* Relay malformed upstream bodies verbatim; the client gets the truth. */
  }
  if (usage) {
    const promise = recordUsage(claims, String(parsed.model), usage, env);
    if (options.waitUntil) {
      options.waitUntil(promise);
    } else {
      void promise;
    }
  }
  return new Response(text, {
    status: upstreamResponse.status,
    headers: { ...headers, ...relayHeaders(upstreamResponse.headers) },
  });
}

/** Extract model id from a /models listing; only used for the relay path. */
async function relayRaw(
  request: Request,
  env: Env,
  tail: string,
  headers: Record<string, string>,
  options: ModelProxyOptions,
): Promise<Response | null> {
  const upstreamCredential = env.FMCV_UPSTREAM_KEY?.trim() ?? '';
  if (!upstreamCredential || !runtimeModelBaseAllowed(env.AISAR_MODEL_BASE)) {
    return jsonError(503, 'model upstream is not configured', headers);
  }
  const fetcher = options.upstreamFetch ?? ((input, init) => globalThis.fetch(input, init));
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetcher(upstreamUrl(env, tail), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${upstreamCredential}`,
        Accept: 'application/json',
        'User-Agent': 'Jentera-Model-Proxy/1',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return jsonError(502, 'model upstream is unreachable', headers);
  }
  return relayResponse(upstreamResponse, headers);
}

function relayResponse(upstreamResponse: Response, headers: Record<string, string>): Response {
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: { ...headers, ...relayHeaders(upstreamResponse.headers) },
  });
}

/** Keep proxy-specific + hop headers out; preserve the response's own
    content-type. Cache-Control no-store so a budget denial is never
    mistaken for a cachable model response. */
function relayHeaders(upstream: Headers): Record<string, string> {
  const out: Record<string, string> = { 'Cache-Control': 'no-store' };
  const contentType = upstream.get('content-type');
  if (contentType) out['Content-Type'] = contentType;
  return out;
}

/**
 * Stream metering: sniffs chunks for the final `"usage":{…}` event that
 * OpenAI-compatible upstreams emit when include_usage is set, meters once,
 * and passes every byte through untouched.
 */
function meteringStream(
  claims: JenteraKeyClaims,
  model: string,
  env: Env,
  waitUntil?: (promise: Promise<unknown>) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  let metered = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      if (!metered && buffer.includes('"usage"')) {
        const usage = extractUsage(buffer);
        if (usage) {
          metered = true;
          const promise = recordUsage(claims, model, usage, env);
          if (waitUntil) waitUntil(promise);
          else void promise;
        }
      }
      /* Keep the scan window bounded while preserving enough tail to find
         a usage event that spans chunk boundaries. */
      if (buffer.length > 128 * 1024) buffer = buffer.slice(-64 * 1024);
      controller.enqueue(chunk);
    },
  });
}

/** Extract the flat usage object ({"prompt_tokens":n,"completion_tokens":n,
    …}) from a chunk buffer containing `"usage":{…}`. Usage objects are flat;
    balance braces to find the end. Returns null when truncated/absent. */
function extractUsage(buffer: string): Record<string, unknown> | null {
  const index = buffer.indexOf('"usage"');
  const open = buffer.indexOf('{', index + '"usage"'.length);
  if (index < 0 || open < 0) return null;
  let depth = 0;
  for (let i = open; i < buffer.length; i++) {
    if (buffer[i] === '{') depth++;
    else if (buffer[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(buffer.slice(open, i + 1)) as Record<string, unknown>;
          return typeof parsed.prompt_tokens === 'number' || typeof parsed.completion_tokens === 'number'
            ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function recordUsage(
  claims: JenteraKeyClaims,
  model: string,
  usage: Record<string, unknown>,
  env: Env,
): Promise<void> {
  const input = safeToken(usage.prompt_tokens);
  const output = safeToken(usage.completion_tokens);
  if (input === 0 && output === 0) return Promise.resolve();
  let microusd: number;
  try {
    microusd = modelCostMicrousd(model, input, output);
  } catch {
    /* Only models with reviewed pricing are metered; an unpriced model
       (misconfiguration) must not break the response path. */
    console.error(`[model-proxy] model ${model} has no reviewed pricing`);
    return Promise.resolve();
  }
  const cents = Math.ceil(microusd / MICROUSD_PER_CENT);
  if (cents <= 0) return Promise.resolve();
  return recordRiderSpend(env, claims.rid, cents, riderMonthKey(new Date()))
    .catch((error) => {
      console.error(`[model-proxy] metering failed: ${String(error)}`);
    });
}

function safeToken(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Map a runtime-facing path to the upstream gateway path. Allowlisted
    bases differ in whether they already carry a version segment
    (https://router.fmcv.my vs https://openrouter.ai/api/v1), so append
    /v1 only when the base does not end in one. Callers check
    runtimeModelBaseAllowed before routing here. */
function upstreamUrl(env: Env, tail: string): string {
  const base = (env.AISAR_MODEL_BASE?.trim() ?? '').replace(/\/+$/, '');
  const hasV1 = /\/v1$/.test(base) || /\/api\/v1$/.test(base);
  return `${base}${hasV1 ? '' : '/v1'}${tail}`;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function jsonError(
  status: number,
  message: string,
  headers: Record<string, string>,
  code = status,
  type = 'invalid_request_error',
): Response {
  return new Response(JSON.stringify({
    error: { message, type, code },
  }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers, 'Cache-Control': 'no-store' },
  });
}
