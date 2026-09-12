import type { Env } from '../env';
import { getRuntime, getRuntimeRegion } from '../agent-runtime';
import { withTenant } from '../db';
import { publishRuntimeTask } from '../runtime';
import { cancelRuntimeTask, findRuntimeApproval } from '../runtime/tasks';
import { applyRuntimeApprovalDecision } from '../runtime/approvals';
import { finalizeRuntimeUsage, runtimeBudgetSnapshot } from '../runtime/usage';
import { finishRun } from '../runs';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { publishRunProgressSafely } from '../runtime/progress';
import { runtimeProvisioningProblem } from '../runtime/execution';
import { prewarmSprite } from '../runtime/prewarm';
import { settleCancelledDraft } from '../telegram-delivery';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

/** Owner-visible status and fail-closed runtime lifecycle controls. */
export async function handleRuntime(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/runtime')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }

  if (url.pathname === '/api/runtime' && request.method === 'GET') {
    const { runtime, budget, observedRegion, setupStatus } = await withTenant(
      env,
      identity.businessId,
      async (tx) => ({
        runtime: await getRuntime(tx, identity.businessId),
        budget: await runtimeBudgetSnapshot(tx, identity.businessId),
        observedRegion: await getRuntimeRegion(tx, identity.businessId),
        setupStatus: (await tx<{ status: string }[]>`select status from runtime_task
          where business_id = ${identity.businessId} and kind = 'provision'
          order by created_at desc limit 1`)[0]?.status ?? null,
      }),
    );
    const expectedRegion = validRegion(env.RUNTIME_EXPECTED_REGION);
    return json({
      ok: true,
      canManage: can(identity, 'runtime.manage'),
      setupStatus,
      runtime: runtime ? {
        status: runtime.status,
        desiredRelease: runtime.desiredRelease,
        observedRelease: runtime.observedRelease,
        lastReadyAt: runtime.lastReadyAt,
        lastError: runtime.lastError,
        observedRegion,
        expectedRegion,
        regionStatus: !observedRegion || !expectedRegion
          ? 'unknown'
          : observedRegion === expectedRegion ? 'optimal' : 'different',
      } : null,
      budget,
    }, {}, { ...cors, 'Cache-Control': 'private, no-store' });
  }

  if (url.pathname === '/api/runtime/wake' && request.method === 'POST') {
    /* The chat page calls this as it opens. The probe runs after the
       response so the page never waits on it; a business without a Sprite
       has nothing to warm and hears so without an error. Any member may
       call it: it changes nothing but the sprite's clock. */
    const runtime = await withTenant(env, identity.businessId, (tx) =>
      getRuntime(tx, identity.businessId));
    const token = env.SPRITES_TOKEN?.trim();
    const warming = Boolean(
      ctx && token && runtime && runtime.provider === 'fly-sprite' && runtime.providerUrl,
    );
    if (warming) {
      ctx!.waitUntil(prewarmSprite(runtime!.providerUrl!, token!, (outcome, extra) => {
        console.info('[runtime-latency]', JSON.stringify({ stage: outcome, source: 'chat_open', ...extra }));
      }));
    }
    return json({ ok: true, warming }, { status: 202 }, cors);
  }
  if (url.pathname === '/api/runtime/provision' && request.method === 'POST') {
    if (!can(identity, 'runtime.manage')) {
      return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    }
    const onboarded = await withTenant(env, identity.businessId, async (tx) => {
      const [business] = await tx<{ onboarded: boolean }[]>`
        select onboarded from business where id = ${identity.businessId}`;
      return business?.onboarded ?? false;
    });
    if (!onboarded) {
      return json({ ok: false, err: 'finish onboarding before creating an agent' }, { status: 409 }, cors);
    }
    const problem = runtimeProvisioningProblem(env);
    if (problem) return json({ ok: false, err: problem }, { status: 503 }, cors);
    const release = env.RUNTIME_RELEASE!.trim();
    const task = await publishRuntimeTask(env, identity.businessId, {
      kind: 'provision',
      dedupeKey: `provision:${identity.businessId}:${release}`,
      payload: { release },
    });
    return json({ ok: true, taskId: task.id, status: task.status }, { status: 202 }, cors);
  }

  if (url.pathname === '/api/runtime/reconcile' && request.method === 'POST') {
    const blocked = mutationProblem(identity, env);
    if (blocked) return json({ ok: false, err: blocked.message }, { status: blocked.status }, cors);
    const window = Math.floor(Date.now() / (5 * 60 * 1_000));
    const task = await publishRuntimeTask(env, identity.businessId, {
      kind: 'reconcile',
      dedupeKey: `reconcile:${identity.businessId}:${window}`,
    });
    return json({ ok: true, taskId: task.id, status: task.status }, { status: 202 }, cors);
  }

  if (url.pathname === '/api/runtime/upgrade' && request.method === 'POST') {
    const blocked = mutationProblem(identity, env);
    if (blocked) return json({ ok: false, err: blocked.message }, { status: blocked.status }, cors);
    const release = env.RUNTIME_RELEASE?.trim();
    if (!release) {
      return json({ ok: false, err: 'runtime release is not configured' }, { status: 503 }, cors);
    }
    const task = await publishRuntimeTask(env, identity.businessId, {
      kind: 'upgrade',
      dedupeKey: `upgrade:${identity.businessId}:${release}`,
      payload: { release },
    });
    return json({ ok: true, taskId: task.id, status: task.status }, { status: 202 }, cors);
  }

  /* What the owner is being asked. Any member may read it — seeing the
     question is not deciding it — and the card needs this after a reload,
     when the socket that announced the approval is long gone. */
  const readApproval = url.pathname.match(/^\/api\/runtime\/approvals\/([0-9a-f-]{36})$/i);
  if (readApproval && request.method === 'GET') {
    const found = await withTenant(env, identity.businessId, (tx) =>
      findRuntimeApproval(tx, identity.businessId, readApproval[1]));
    if (!found) return json({ ok: false, err: 'approval not found' }, { status: 404 }, cors);
    return json(
      {
        ok: true,
        approval: {
          id: found.approval.id,
          tool: found.approval.tool,
          message: found.approval.message,
          status: found.approval.status,
          expiresAt: found.approval.expiresAt,
          surface: found.approval.surface,
          runId: found.task.runId ?? null,
          /* Deliberately not the requestId: it is what the runner binds a
             decision to, and no surface needs to see it. */
        },
      },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
      cors,
    );
  }

  const decide = url.pathname
    .match(/^\/api\/runtime\/approvals\/([0-9a-f-]{36})\/decide$/i);
  if (decide && request.method === 'POST') {
    /* Owner only. Approving a tool call can run a command on the business's
       machine, which is the same line the connector decide route draws when
       it says a staff member must not authorise a customer-facing send.
       Staff can read the card above; the buttons are theirs to look at. */
    if (!can(identity, 'approvals.decide')) {
      return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    }
    /* The SameSite=Lax cookie is the real cross-site defence; these are the
       belt to its braces. request-guard checks method, size and rate, and
       the CORS headers in index.ts shape the *response* — none of them stops
       a cross-site POST from arriving. */
    const origin = request.headers.get('Origin');
    if (!origin || cors['Access-Control-Allow-Origin'] !== origin) {
      return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    }
    if (!(request.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) {
      return json({ ok: false, err: 'json body required' }, { status: 415 }, cors);
    }
    let decision: unknown;
    try {
      decision = ((await request.json()) as { decision?: unknown }).decision;
    } catch {
      return json({ ok: false, err: 'body is not valid JSON' }, { status: 400 }, cors);
    }
    if (decision !== 'approve' && decision !== 'deny') {
      return json({ ok: false, err: 'decision must be approve or deny' }, { status: 400 }, cors);
    }

    const result = await applyRuntimeApprovalDecision(
      env,
      identity.businessId,
      { surface: 'web', approvalId: decide[1], userId: identity.userId },
      decision,
    );
    const body = (status: string) => ({
      ok: true,
      status,
      approval: result.approval
        ? {
            id: result.approval.id,
            tool: result.approval.tool,
            status: result.approval.status,
            decision: result.approval.decision ?? null,
          }
        : null,
    });
    const headers = { 'Cache-Control': 'private, no-store' };
    if (result.outcome === 'accepted') {
      /* Nothing is published here: the consumer publishes `working` when it
         leases the resume, and the durable row is what the card reads if the
         socket is gone. Announcing it twice would race that. */
      return json(body('applied'), { status: 200, headers }, cors);
    }
    if (result.outcome === 'duplicate') {
      return json(body('already_applied'), { status: 200, headers }, cors);
    }
    if (result.outcome === 'unavailable') {
      return json(
        { ok: false, code: 'RUNTIME_UNAVAILABLE' },
        { status: 503, headers: { ...headers, 'Retry-After': '2' } },
        cors,
      );
    }
    return json({ ok: false, code: 'APPROVAL_NOT_PENDING' }, { status: 409, headers }, cors);
  }

  const cancel = url.pathname.match(/^\/api\/runtime\/tasks\/([0-9a-f-]{36})\/cancel$/i);
  if (cancel && request.method === 'POST') {
    if (!can(identity, 'runtime.manage')) {
      return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    }
    const cancelled = await withTenant(env, identity.businessId, async (tx) => {
      const outcome = await cancelRuntimeTask(tx, identity.businessId, cancel[1]);
      if (!outcome) return null;
      if (outcome.changed && outcome.task.kind === 'run') {
        await finalizeRuntimeUsage(tx, identity.businessId, outcome.task.id, 'cancelled', {
          inputTokens: 0,
          outputTokens: 0,
        });
        if (outcome.task.runId) {
          await finishRun(tx, identity.businessId, outcome.task.runId, 'cancelled', {
            runtimeTaskId: outcome.task.id,
            reason: 'owner_cancelled',
          });
        }
      }
      return outcome;
    });
    if (!cancelled) {
      return json({ ok: false, err: 'runtime task not found' }, { status: 404 }, cors);
    }
    if (!cancelled.changed && !['cancelled', 'exhausted'].includes(cancelled.task.status)) {
      return json({ ok: false, err: 'runtime task is already terminal' }, { status: 409 }, cors);
    }
    if (cancelled.changed && cancelled.task.kind === 'run' && !cancelled.task.remoteRunId) {
      await settleCancelledDraft(env, identity.businessId, cancelled.task.id, cancelled.task.payload);
    }
    if (cancelled.task.kind === 'run' && cancelled.task.remoteRunId) {
      const window = Math.floor(Date.now() / 60_000);
      await publishRuntimeTask(env, identity.businessId, {
        kind: 'cancel',
        dedupeKey: `cancel:${cancelled.task.id}:${window}`,
        payload: { targetTaskId: cancelled.task.id },
      });
    }
    if (cancelled.task.kind === 'run' && cancelled.task.runId) {
      await publishRunProgressSafely(
        env,
        identity.businessId,
        cancelled.task.runId,
        'cancelled',
      );
    }
    return json({ ok: true, taskId: cancelled.task.id, status: 'cancelled' }, {}, cors);
  }

  if (url.pathname === '/api/runtime' && request.method === 'DELETE') {
    if (!can(identity, 'runtime.manage')) {
      return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    }
    const runtime = await withTenant(env, identity.businessId, (tx) =>
      getRuntime(tx, identity.businessId));
    if (!runtime) return json({ ok: true, status: 'absent' }, {}, cors);
    const task = await publishRuntimeTask(env, identity.businessId, {
      kind: 'delete',
      dedupeKey: `delete:${runtime.id}:${Math.floor(Date.now() / 60_000)}`,
    });
    return json({ ok: true, taskId: task.id, status: task.status }, { status: 202 }, cors);
  }

  return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
}

function validRegion(value: string | undefined): string | null {
  const region = value?.trim().toLowerCase() ?? '';
  return /^[a-z0-9]{3}$/.test(region) ? region : null;
}

function mutationProblem(
  identity: { role: string | null },
  env: Env,
): { status: number; message: string } | null {
  if (!can(identity, 'runtime.manage')) return { status: 403, message: 'owner access required' };
  const problem = runtimeProvisioningProblem(env);
  if (problem) return { status: 503, message: problem };
  return null;
}
