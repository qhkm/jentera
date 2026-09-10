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

   Two records come out of every call, and they answer different
   questions. `fmcv_rider_spend` is the meter the ceiling reads: one
   running total per rider per month. `model_call` is a diagnostic: one
   row per upstream call carrying token counts and the *shape* of the
   prompt — fixed overhead, transcript, last user message — because
   `runtime_usage.input_tokens` is a single per-run sum and cannot say
   which of those made a prompt big. It records unmetered streams too,
   so the size of the metering gap above is a number rather than a
   caveat. Never content, and no tenant columns.
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
import { connect } from '../db';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RELAY_BODY_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000;
/** 1 USD-cent = 10,000 micro-USD. */

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

  /* Serialise once: the same bytes go upstream and are measured, so
     request_bytes is what was actually sent, injection included. */
  const outboundBody = JSON.stringify(parsed);
  const shape = promptShape(parsed, outboundBody.length);
  const startedAt = Date.now();
  const keepAlive = (promise: Promise<unknown>): void => {
    if (options.waitUntil) options.waitUntil(promise);
    else void promise;
  };

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
      body: outboundBody,
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
        { shape, startedAt, upstreamStatus: upstreamResponse.status },
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
    keepAlive(recordUsage(claims, String(parsed.model), usage, env));
  }
  /* Recorded whether or not the body carried usage: a non-streaming reply
     without it is exactly the gap this table exists to size. */
  keepAlive(recordModelCall(env, claims, String(parsed.model), shape, {
    streamed: false,
    usage,
    upstreamStatus: upstreamResponse.status,
    latencyMs: Date.now() - startedAt,
  }));
  return new Response(text, {
    status: upstreamResponse.status,
    headers: { ...headers, ...relayHeaders(upstreamResponse.headers) },
  });
}

/** Delete model_call rows past their retention window. The table is a
    diagnostic for reading prompt shape over days, not a ledger, so it is
    swept rather than kept; fmcv_rider_spend is what the ceiling reads and
    is untouched by this. Bounded per run so the cron cannot stall on a
    backlog. */
export async function sweepModelCalls(env: Env, retentionDays = 90): Promise<number> {
  const sql = connect(env);
  try {
    const deleted = await sql<{ id: string }[]>`
      delete from model_call
       where id in (
         select id from model_call
          where created_at < now() - ${`${retentionDays} days`}::interval
          limit 5000
       )
       returning id`;
    return deleted.length;
  } finally {
    await sql.end({ timeout: 1 });
  }
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
  accounting?: { shape: PromptShape; startedAt: number; upstreamStatus: number },
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  let metered = false;
  let seen: Record<string, unknown> | null = null;
  const keepAlive = (promise: Promise<unknown>): void => {
    if (waitUntil) waitUntil(promise);
    else void promise;
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      if (!metered && buffer.includes('"usage"')) {
        const usage = extractUsage(buffer);
        if (usage) {
          metered = true;
          seen = usage;
          keepAlive(recordUsage(claims, model, usage, env));
        }
      }
      /* Keep the scan window bounded while preserving enough tail to find
         a usage event that spans chunk boundaries. */
      if (buffer.length > 128 * 1024) buffer = buffer.slice(-64 * 1024);
      controller.enqueue(chunk);
    },
    /* One row per stream, at the end, so a stream that closed without ever
       carrying a usage chunk is counted rather than silently lost. Those
       calls are real spend the rider ledger never saw, and their number is
       the size of the metering gap. */
    flush() {
      if (!accounting) return;
      keepAlive(recordModelCall(env, claims, model, accounting.shape, {
        streamed: true,
        usage: seen,
        upstreamStatus: accounting.upstreamStatus,
        latencyMs: Date.now() - accounting.startedAt,
      }));
    },
  });
}

/** Extract the usage object ({"prompt_tokens":n,"completion_tokens":n,…})
    from a chunk buffer. OpenAI-style streams with include_usage carry
    `"usage":null` on every content chunk and the object only on the last,
    and the word can also appear inside delta text; so every occurrence is
    examined and only a `"usage": {` whose braces balance into an object
    with token counts is accepted. Returns null when absent or truncated. */
function extractUsage(buffer: string): Record<string, unknown> | null {
  const key = '"usage"';
  let from = 0;
  for (;;) {
    const index = buffer.indexOf(key, from);
    if (index < 0) return null;
    from = index + key.length;
    let cursor = from;
    while (cursor < buffer.length && ' \t\r\n'.includes(buffer[cursor])) cursor++;
    if (buffer[cursor] !== ':') continue;
    cursor++;
    while (cursor < buffer.length && ' \t\r\n'.includes(buffer[cursor])) cursor++;
    if (buffer[cursor] !== '{') continue;
    const parsed = balancedObject(buffer, cursor);
    if (parsed === undefined) return null; // truncated: wait for more bytes
    if (parsed && (typeof parsed.prompt_tokens === 'number' ||
        typeof parsed.completion_tokens === 'number')) {
      return parsed;
    }
  }
}

/** Parse the JSON object starting at `open`. `undefined` when the object
    is not closed yet in this buffer; null when it closes but is not JSON. */
function balancedObject(buffer: string, open: number): Record<string, unknown> | null | undefined {
  let depth = 0;
  let inString = false;
  for (let i = open; i < buffer.length; i++) {
    const c = buffer[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(buffer.slice(open, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return undefined;
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
  if (microusd <= 0) return Promise.resolve();
  return recordRiderSpend(env, claims.rid, microusd, riderMonthKey(new Date()))
    .catch((error) => {
      console.error(`[model-proxy] metering failed: ${String(error)}`);
    });
}

function safeToken(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The three components of a prompt, measured rather than guessed.
 *
 * `runtime_usage.input_tokens` is one number per run — Hermes's
 * session_prompt_tokens summed over every call — so it cannot say whether a
 * large prompt is fixed overhead (system prompt plus tool schemas), the
 * accumulated transcript, or one enormous tool result. Those have different
 * levers. Characters, not tokens, because the proxy must not run a
 * tokenizer on the request path; the ratio is stable enough to compare
 * calls against each other, which is all this is for.
 *
 * The last user message is measured separately because it is the only part
 * the owner actually typed: everything else is the loop talking to itself. */
export function promptShape(parsed: Record<string, unknown>, requestBytes: number): PromptShape {
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
  const contentChars = (message: unknown): number => {
    if (!message || typeof message !== 'object') return 0;
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return content.length;
    /* Multi-part content: sum the text parts, ignore binary references. */
    if (Array.isArray(content)) {
      return content.reduce<number>((total, part) => {
        const text = part && typeof part === 'object' ? (part as { text?: unknown }).text : undefined;
        return total + (typeof text === 'string' ? text.length : 0);
      }, 0);
    }
    /* Tool-call payloads live outside `content`; count the whole message. */
    return content === undefined || content === null ? JSON.stringify(message).length : 0;
  };
  const roleOf = (message: unknown): string =>
    message && typeof message === 'object' && typeof (message as { role?: unknown }).role === 'string'
      ? (message as { role: string }).role
      : '';

  let systemChars = 0;
  for (const message of messages) if (roleOf(message) === 'system') systemChars += contentChars(message);

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) === 'user') { lastUserIndex = i; break; }
  }
  const lastUserChars = lastUserIndex >= 0 ? contentChars(messages[lastUserIndex]) : 0;

  let historyChars = 0;
  for (let i = 0; i < messages.length; i++) {
    if (i === lastUserIndex || roleOf(messages[i]) === 'system') continue;
    historyChars += contentChars(messages[i]);
  }

  return {
    requestBytes,
    messageCount: messages.length,
    toolCount: tools.length,
    systemChars,
    toolsChars: tools.length > 0 ? JSON.stringify(tools).length : 0,
    historyChars,
    lastUserChars,
  };
}

export interface PromptShape {
  requestBytes: number;
  messageCount: number;
  toolCount: number;
  systemChars: number;
  toolsChars: number;
  historyChars: number;
  lastUserChars: number;
}

/** One diagnostic row per upstream call. Never on the response path: the
    caller hands this to waitUntil, and a failure is logged, not raised —
    a broken diagnostic must not cost anyone a reply. */
function recordModelCall(
  env: Env,
  claims: JenteraKeyClaims,
  model: string,
  shape: PromptShape,
  call: {
    streamed: boolean;
    usage: Record<string, unknown> | null;
    upstreamStatus: number;
    latencyMs: number;
  },
): Promise<void> {
  const usage = call.usage;
  const promptTokens = usage ? safeToken(usage.prompt_tokens) : null;
  const completionTokens = usage ? safeToken(usage.completion_tokens) : null;
  const details = usage && typeof usage.prompt_tokens_details === 'object' && usage.prompt_tokens_details
    ? usage.prompt_tokens_details as Record<string, unknown>
    : null;
  const cachedTokens = details ? safeToken(details.cached_tokens) : null;
  let costMicrousd: number | null = null;
  if (promptTokens !== null && completionTokens !== null) {
    try {
      costMicrousd = modelCostMicrousd(model, promptTokens, completionTokens);
    } catch {
      /* Unpriced model: the shape is still worth recording. */
    }
  }
  const sql = connect(env);
  return sql`
    insert into model_call (
      rider_id, model, streamed, usage_seen,
      prompt_tokens, completion_tokens, cached_tokens, cost_microusd,
      request_bytes, message_count, tool_count,
      system_chars, tools_chars, history_chars, last_user_chars,
      upstream_status, latency_ms
    ) values (
      ${claims.rid}, ${model}, ${call.streamed}, ${usage !== null},
      ${promptTokens}, ${completionTokens}, ${cachedTokens}, ${costMicrousd},
      ${shape.requestBytes}, ${shape.messageCount}, ${shape.toolCount},
      ${shape.systemChars}, ${shape.toolsChars}, ${shape.historyChars}, ${shape.lastUserChars},
      ${call.upstreamStatus}, ${call.latencyMs}
    )`
    .then(() => undefined)
    .catch((error) => {
      console.error(`[model-proxy] call accounting failed: ${String(error)}`);
    })
    .finally(() => sql.end({ timeout: 1 }).catch(() => undefined));
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
