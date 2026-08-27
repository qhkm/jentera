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
import { handleConnect } from './routes/connect';
import { handleRuntime } from './routes/runtime';
import { hasBusiness, resolveTenant } from './tenancy';
import type { Env } from './env';
import { handleRuntimeMessage, type RuntimeQueueMessage } from './runtime/consumer';
import { guardApiRequest } from './request-guard';
import { runtimeModelKeyNeedsRotation } from './runtime/openrouter-keys';
import { publishRuntimeTask } from './runtime/consumer';

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
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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

    const guarded = await guardApiRequest(request, env, url, headers);
    if (guarded) return guarded;

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

    /* Connections, and the Telegram webhook — the one route here that
       is called by someone other than our own frontend. */
    const conn = await handleConnect(request, env, url, headers);
    if (conn) return conn;

    const runtime = await handleRuntime(request, env, url, headers);
    if (runtime) return runtime;

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

  async queue(batch: MessageBatch<RuntimeQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const result = await handleRuntimeMessage(env, message.body);
        if (result.action === 'ack') message.ack();
        else if (result.action === 'requeue') {
          console.warn(
            `[runtime-queue] task=${message.body.taskId} action=requeue ` +
            `reason=${logValue(result.reason)}`,
          );
          if (!env.RUNTIME_QUEUE) throw new Error('RUNTIME_QUEUE is not configured');
          await env.RUNTIME_QUEUE.send(message.body, { delaySeconds: result.delaySeconds });
          message.ack();
        } else {
          console.warn(
            `[runtime-queue] task=${message.body.taskId} action=retry ` +
            `reason=${logValue(result.reason)}`,
          );
          message.retry({ delaySeconds: result.delaySeconds });
        }
      } catch (error) {
        console.error(`[runtime-queue] ${String(error)}`);
        message.retry({ delaySeconds: 60 });
      }
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    /* This scans only the explicit canary set and reads Postgres; it does not
       wake a Sprite unless its model key is missing, staged, or within the
       seven-day rotation window. A fleet scheduler will use its own index. */
    const canaries = new Set((env.RUNTIME_CANARY_BUSINESS_IDS ?? '')
      .split(',').map((value) => value.trim()).filter(uuid));
    const day = Math.floor(Date.now() / (24 * 60 * 60 * 1_000));
    for (const businessId of canaries) {
      try {
        if (!await runtimeModelKeyNeedsRotation(env, businessId)) continue;
        await publishRuntimeTask(env, businessId, {
          kind: 'upgrade',
          dedupeKey: `model-key-rotation:${businessId}:${day}`,
          payload: { reason: 'model_key_rotation' },
        });
      } catch (error) {
        console.error(`[runtime-rotation] business=${businessId} error=${logValue(String(error))}`);
      }
    }
  },
} satisfies ExportedHandler<Env, RuntimeQueueMessage>;

function logValue(value: string): string {
  return value.replace(/[\r\n\t\u0000-\u001f]/g, ' ').slice(0, 500);
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
