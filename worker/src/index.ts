/* ============================================================
   AISAR API — the executor behind the client's tool contract.

   Same shape the client already speaks, so swapping the local mock
   for this Worker changes one environment variable and nothing else.

   The rule the whole product rests on: anything above low risk is
   queued for a human, never executed on the agent's say-so.
   ============================================================ */

import { handleSession } from './routes/session';
import { handleRepo } from './routes/repo';
import { handleRuns } from './routes/runs';
import { hasBusiness, resolveTenant } from './tenancy';
import type { Env } from './env';

function cors(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = origin && allowed.includes(origin);

  /* Credentialed requests are strict in two ways the non-credentialed
     case is not: the browser rejects a wildcard origin outright, and it
     drops the cookie unless Allow-Credentials is present. RemoteRepository
     sends credentials: 'include' on every call, so an unlisted origin must
     get no CORS headers at all rather than a permissive default — echoing
     allowed[0] back would be a lie the browser then refuses anyway. */
  if (!ok) return { Vary: 'Origin' };

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

interface ToolRequest {
  conn?: string;
  op?: string;
  args?: Record<string, unknown>;
  dryRun?: boolean;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers = cors(env, origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    /* Sign-in, session and identity. Returns null when the path is not
       one of these, so the tool-contract routes below still run. */
    const session = await handleSession(request, env, url, headers);
    if (session) return session;

    /* The Repository interface's 17 methods. */
    const repo = await handleRepo(request, env, url, headers);
    if (repo) return repo;

    /* Runs: ingestion, activity, and one run's trace. */
    const runs = await handleRuns(request, env, url, headers);
    if (runs) return runs;

    try {
      /* ---- POST /api/tools/call ---------------------------------- */
      /* ---- GET /api/approvals?business=…&status=… ---------------- */
      /* ---- POST /api/approvals/:id/decide ------------------------ */
      /* ---- GET /api/health --------------------------------------- */
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: 'aisar-api' }, {}, headers);
      }

      return json({ ok: false, err: 'not found' }, { status: 404 }, headers);
    } catch (err) {
      return json({ ok: false, err: (err as Error).message }, { status: 500 }, headers);
    }
  },
} satisfies ExportedHandler<Env>;
