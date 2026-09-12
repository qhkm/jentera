/* ============================================================
   Jentera API — the executor behind the client's tool contract.

   Same shape the client already speaks, so swapping the local mock
   for this Worker changes one environment variable and nothing else.

   The rule the whole product rests on: anything above low risk is
   queued for a human, never executed on the agent's say-so.
   ============================================================ */

const ROUTINES_CRON = '* * * * *';

import { handleSession } from './routes/session';
import { handleRepo } from './routes/repo';
import { handleRuns } from './routes/runs';
import { handleRoutines } from './routes/routines';
import { handlePush } from './routes/push';
import { handleArtifacts, RUNTIME_ARTIFACTS_PATH } from './routes/artifacts';
import { sweepPushOutbox } from './push/outbox';
import { handleNotifications } from './routes/notifications';
import { handleTeam } from './routes/team';
import { handleWorkspaces } from './routes/workspaces';
import { handleChats } from './routes/chats';
import { handleAgentMemory } from './routes/agent-memory';
import { dispatchDueRoutines } from './routines/dispatch';
import { handleConnect } from './routes/connect';
import { handleRuntime } from './routes/runtime';
import { handleBrowser } from './routes/browser';
import { handleEvents } from './routes/events';
import { handleSupport } from './routes/support';
import { handleModelProxy, sweepModelCalls } from './routes/model';
import { handleRuntimeConfig } from './routes/runtime-config';
import { hasBusiness, resolveTenant } from './tenancy';
import type { Env } from './env';
import { handleQueueMessagePlaced } from './runtime/placed-slice';
import {
  drainRuntimeTaskOutbox,
  scheduleRuntimeTaskWake,
  sweepRuntimeDrift,
  sweepRuntimeTaskRecovery,
  type RuntimeQueueMessage,
} from './runtime/consumer';
import { guardApiRequest } from './request-guard';

export { RunStream } from './run-stream';

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers = cors(env, origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    /* Runtime-facing model proxy. Mounted before the API guard: chat
       bodies/SSE exceed the API body cap, and these requests carry a
       jentera runtime credential rather than a frontend cookie. */
    const modelProxy = await handleModelProxy(request, env, url, headers, {
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
    if (modelProxy) return modelProxy;

    /* Runtime configuration, mounted here for the same reason: a sprite
       presents a runtime credential, not a session cookie. */
    const runtimeConfig = await handleRuntimeConfig(request, env, url, headers);
    if (runtimeConfig) return runtimeConfig;
    /* A task's output files, uploaded by the runner with the same credential. */
    if (url.pathname === RUNTIME_ARTIFACTS_PATH) {
      const uploaded = await handleArtifacts(request, env, url, headers);
      if (uploaded) return uploaded;
    }

    const guarded = await guardApiRequest(request, env, url, headers);
    if (guarded) return guarded;

    /* Sign-in, session and identity. Returns null when the path is not
       one of these, so the tool-contract routes below still run. */
    const session = await handleSession(request, env, url, headers);
    if (session) return session;

    const events = await handleEvents(request, env, url, headers);
    if (events) return events;

    /* Staff support endpoints: key-authenticated, not session-based. */
    const support = await handleSupport(request, env, url, headers);
    if (support) return support;

    /* The Repository interface's 17 methods. */
    const repo = await handleRepo(request, env, url, headers);
    if (repo) return repo;

    /* Runs: ingestion, activity, and one run's trace. */
    const runs = await handleRuns(request, env, url, headers, ctx);
    if (runs) return runs;

    const push = await handlePush(request, env, url, headers, { ctx });
    if (push) return push;
    const artifacts = await handleArtifacts(request, env, url, headers);
    if (artifacts) return artifacts;
    /* Routines: owner-scheduled deterministic jobs, behind a flag. */
    const routines = await handleRoutines(request, env, url, headers);
    if (routines) return routines;

    const notifications = await handleNotifications(request, env, url, headers);
    if (notifications) return notifications;

    /* The team: members and invitations. A plan, not a default. */
    const team = await handleTeam(request, env, url, headers);
    if (team) return team;
    const workspaces = await handleWorkspaces(request, env, url, headers);
    if (workspaces) return workspaces;
    const chatList = await handleChats(request, env, url, headers);
    if (chatList) return chatList;
    const agentMemory = await handleAgentMemory(request, env, url, headers);
    if (agentMemory) return agentMemory;

    /* Connections, and the Telegram webhook — the one route here that
       is called by someone other than our own frontend. */
    const conn = await handleConnect(request, env, url, headers, ctx);
    if (conn) return conn;

    const runtime = await handleRuntime(request, env, url, headers, ctx);
    if (runtime) return runtime;
    const browser = await handleBrowser(request, env, url, headers);
    if (browser) return browser;

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

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    /* The one-minute cron dispatches owner routines; the quarter-hour cron
       runs the fleet sweep. Both fire together at :00, :15, :30 and :45. */
    if (controller.cron === ROUTINES_CRON) {
      const started = Date.now();
      try {
        const result = await dispatchDueRoutines(env);
        if (result.admitted || result.skipped || result.errors) {
          console.log(
            `[routines] admitted=${result.admitted} skipped=${result.skipped} ` +
            `errors=${result.errors} took=${Date.now() - started}ms`,
          );
        }
      } catch (err) {
        console.error(`[routines] ${String(err)}`);
      }
      /* Notifications queued for the owner's devices go out on the same tick. */
      try {
        const pushed = await sweepPushOutbox(env);
        if (pushed.delivered || pushed.retried || pushed.gaveUp) {
          console.log(`[push-outbox] delivered=${pushed.delivered} retried=${pushed.retried} gaveUp=${pushed.gaveUp}`);
        }
      } catch (err) {
        console.error(`[push-outbox] ${String(err)}`);
      }
      return;
    }

    /* Fleet drift sweep — keep every sprite on the pinned release without
       waiting for each business's next customer message, and re-arm lifecycle
       tasks whose exhaustion was infra noise rather than a product bug. */
    const started = Date.now();
    try {
      const recovered = await sweepRuntimeTaskRecovery(env);
      const drainedBefore = await drainRuntimeTaskOutbox(env);
      const published = await sweepRuntimeDrift(env);
      const drainedAfter = await drainRuntimeTaskOutbox(env);
      const sweptCalls = await sweepModelCalls(env);
      console.log(
        `[drift-sweep] recovered=${recovered} published=${published} ` +
        `drained=${drainedBefore + drainedAfter} model_calls_swept=${sweptCalls} ` +
        `took=${Date.now() - started}ms`,
      );
    } catch (err) {
      console.error(`[drift-sweep] ${String(err)}`);
    }
  },

  async queue(batch: MessageBatch<RuntimeQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const result = await handleQueueMessagePlaced(env, message.body);
        const queueId = runtimeQueueMessageId(message.body);
        if (!result.placed) console.warn(`[runtime-queue] task=${queueId} ran unplaced`);
        if (result.action === 'ack') message.ack();
        else if (result.action === 'requeue') {
          console.warn(
            `[runtime-queue] task=${queueId} action=requeue ` +
            `reason=${logValue(result.reason)}`,
          );
          const wake = result.nextMessage ??
            (message.body.version === 1 ? message.body : null);
          if (!wake) throw new Error('runtime task wake target is unavailable');
          await scheduleRuntimeTaskWake(
            env,
            wake.businessId,
            wake.taskId,
            result.delaySeconds,
          );
          message.ack();
        } else {
          console.warn(
            `[runtime-queue] task=${queueId} action=retry ` +
            `reason=${logValue(result.reason)}`,
          );
          if (result.nextMessage) {
            await scheduleRuntimeTaskWake(
              env,
              result.nextMessage.businessId,
              result.nextMessage.taskId,
              result.delaySeconds,
            );
            message.ack();
          } else {
            message.retry({ delaySeconds: result.delaySeconds });
          }
        }
      } catch (error) {
        console.error(`[runtime-queue] ${String(error)}`);
        message.retry({ delaySeconds: 60 });
      }
    }
  },

} satisfies ExportedHandler<Env, RuntimeQueueMessage>;

function logValue(value: string): string {
  return value.replace(/[\r\n\t\u0000-\u001f]/g, ' ').slice(0, 500);
}

function runtimeQueueMessageId(message: RuntimeQueueMessage): string {
  return message.version === 1
    ? message.taskId
    : `telegram:${message.connectionId}:${message.incoming.messageId}`;
}
