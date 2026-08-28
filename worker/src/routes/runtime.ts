import type { Env } from '../env';
import { getRuntime } from '../agent-runtime';
import { withTenant } from '../db';
import { publishRuntimeTask } from '../runtime';
import { cancelRuntimeTask } from '../runtime/tasks';
import { finalizeRuntimeUsage, runtimeBudgetSnapshot } from '../runtime/usage';
import { finishRun } from '../runs';
import { hasBusiness, resolveTenant } from '../tenancy';
import { publishRunProgressSafely } from '../runtime/progress';
import { runtimeProvisioningProblem } from '../runtime/execution';

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
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/runtime')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }

  if (url.pathname === '/api/runtime' && request.method === 'GET') {
    const { runtime, budget } = await withTenant(env, identity.businessId, async (tx) => ({
      runtime: await getRuntime(tx, identity.businessId),
      budget: await runtimeBudgetSnapshot(tx, identity.businessId),
    }));
    return json({
      ok: true,
      runtime: runtime ? {
        status: runtime.status,
        desiredRelease: runtime.desiredRelease,
        observedRelease: runtime.observedRelease,
        lastReadyAt: runtime.lastReadyAt,
        lastError: runtime.lastError,
      } : null,
      budget,
    }, {}, cors);
  }

  if (url.pathname === '/api/runtime/provision' && request.method === 'POST') {
    if (identity.role !== 'owner') {
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
    const blocked = mutationProblem(identity.role, env);
    if (blocked) return json({ ok: false, err: blocked.message }, { status: blocked.status }, cors);
    const window = Math.floor(Date.now() / (5 * 60 * 1_000));
    const task = await publishRuntimeTask(env, identity.businessId, {
      kind: 'reconcile',
      dedupeKey: `reconcile:${identity.businessId}:${window}`,
    });
    return json({ ok: true, taskId: task.id, status: task.status }, { status: 202 }, cors);
  }

  if (url.pathname === '/api/runtime/upgrade' && request.method === 'POST') {
    const blocked = mutationProblem(identity.role, env);
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

  const cancel = url.pathname.match(/^\/api\/runtime\/tasks\/([0-9a-f-]{36})\/cancel$/i);
  if (cancel && request.method === 'POST') {
    if (identity.role !== 'owner') {
      return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    }
    const cancelled = await withTenant(env, identity.businessId, async (tx) => {
      const outcome = await cancelRuntimeTask(tx, identity.businessId, cancel[1]);
      if (!outcome) return null;
      if (outcome.changed && outcome.task.kind === 'run') {
        if (!outcome.task.remoteRunId) {
          await finalizeRuntimeUsage(tx, identity.businessId, outcome.task.id, 'cancelled', {
            inputTokens: 0,
            outputTokens: 0,
          });
        }
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
    if (identity.role !== 'owner') {
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

function mutationProblem(
  role: string | null,
  env: Env,
): { status: number; message: string } | null {
  if (role !== 'owner') return { status: 403, message: 'owner access required' };
  const problem = runtimeProvisioningProblem(env);
  if (problem) return { status: 503, message: problem };
  return null;
}
