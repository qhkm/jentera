import type { Env } from '../env';
import { getRuntime } from '../agent-runtime';
import { withTenant } from '../db';
import { publishRuntimeTask } from '../runtime';
import { hasBusiness, resolveTenant } from '../tenancy';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

/** Owner-visible status and a doubly-locked internal canary trigger. */
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
    const runtime = await withTenant(env, identity.businessId, (tx) =>
      getRuntime(tx, identity.businessId),
    );
    return json({
      ok: true,
      runtime: runtime ? {
        status: runtime.status,
        desiredRelease: runtime.desiredRelease,
        observedRelease: runtime.observedRelease,
        lastReadyAt: runtime.lastReadyAt,
        lastError: runtime.lastError,
      } : null,
    }, {}, cors);
  }

  if (url.pathname === '/api/runtime/provision' && request.method === 'POST') {
    if (identity.role !== 'owner') {
      return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    }
    if (env.RUNTIME_PROVISIONING_ENABLED !== 'true') {
      return json({ ok: false, err: 'runtime provisioning is disabled' }, { status: 503 }, cors);
    }
    if (env.VRS_TRANSPORT_READY !== 'true') {
      return json({ ok: false, err: 'secure model transport is not ready' }, { status: 503 }, cors);
    }
    if (env.RUNTIME_BOOTSTRAP_ENABLED !== 'true') {
      return json({ ok: false, err: 'production runtime bootstrap is disabled' }, { status: 503 }, cors);
    }
    const canaries = new Set((env.RUNTIME_CANARY_BUSINESS_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean));
    if (!canaries.has(identity.businessId)) {
      return json({ ok: false, err: 'business is not in the runtime canary' }, { status: 403 }, cors);
    }
    const release = env.RUNTIME_RELEASE?.trim();
    if (!release) {
      return json({ ok: false, err: 'runtime release is not configured' }, { status: 503 }, cors);
    }
    const task = await publishRuntimeTask(env, identity.businessId, {
      kind: 'provision',
      dedupeKey: `provision:${identity.businessId}:${release}`,
      payload: { release },
    });
    return json({ ok: true, taskId: task.id, status: task.status }, { status: 202 }, cors);
  }

  return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
}
