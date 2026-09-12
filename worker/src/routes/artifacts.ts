/* ============================================================
   Artifacts.

   POST /v1/runtime/artifacts   the runner uploads one of a task's output
                                files; runtime credential, not a session
   GET  /api/artifacts          the owner's files, newest first
                                (?runId= for one run, ?limit=)
   GET  /api/artifacts/:id      the bytes, as an attachment

   The upload names a task, and the task's tenant is the runtime's tenant:
   the runtime credential resolves to a business, and the task row must be
   that business's. Nothing in the request body or headers chooses a tenant.
   ============================================================ */
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { resolveRuntimeIdentity, RuntimeIdentityError } from '../runtime/identity';
import { runVisibleTo } from '../chat-sessions';
import {
  artifactJson,
  artifactKey,
  countArtifactsForRun,
  getArtifact,
  listArtifacts,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACTS_PER_RUN,
  recordArtifact,
  safeArtifactName,
  safeContentType,
} from '../artifacts';

export const RUNTIME_ARTIFACTS_PATH = '/v1/runtime/artifacts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleArtifacts(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname === RUNTIME_ARTIFACTS_PATH) {
    if (request.method !== 'POST') return json({ ok: false, err: 'artifacts only accept POST' }, { status: 405 }, cors);
    let identity;
    try {
      identity = await resolveRuntimeIdentity(env, request);
    } catch (err) {
      if (err instanceof RuntimeIdentityError) return json({ ok: false, err: err.message }, { status: err.status }, cors);
      throw err;
    }
    if (!env.ARTIFACTS) return json({ ok: false, err: 'artifact storage is not configured' }, { status: 503 }, cors);

    const taskId = request.headers.get('X-Aisar-Task-Id') ?? '';
    if (!UUID.test(taskId)) return json({ ok: false, err: 'X-Aisar-Task-Id must be the task id' }, { status: 400 }, cors);
    const name = safeArtifactName(request.headers.get('X-Aisar-Artifact-Name'));
    if (!name) {
      return json({ ok: false, err: 'X-Aisar-Artifact-Name must be a bare file name: letters, digits, dot, dash, underscore' }, { status: 400 }, cors);
    }
    const declared = Number(request.headers.get('Content-Length'));
    if (!Number.isFinite(declared) || declared < 0) return json({ ok: false, err: 'Content-Length is required' }, { status: 400 }, cors);
    if (declared > MAX_ARTIFACT_BYTES) return json({ ok: false, err: `a file is at most ${MAX_ARTIFACT_BYTES} bytes` }, { status: 413 }, cors);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return json({ ok: false, err: 'the file is empty' }, { status: 400 }, cors);
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) return json({ ok: false, err: `a file is at most ${MAX_ARTIFACT_BYTES} bytes` }, { status: 413 }, cors);
    const contentType = safeContentType(request.headers.get('Content-Type'));
    const { businessId } = identity;

    const target = await withTenant(env, businessId, async (tx) => {
      const [task] = await tx<{ run_id: string | null }[]>`
        select run_id from runtime_task where id = ${taskId} and business_id = ${businessId}`;
      if (!task?.run_id) return null;
      return { runId: task.run_id, count: await countArtifactsForRun(tx, businessId, task.run_id) };
    });
    if (!target) return json({ ok: false, err: 'task not found' }, { status: 404 }, cors);
    if (target.count >= MAX_ARTIFACTS_PER_RUN) {
      return json({ ok: false, err: `a run carries at most ${MAX_ARTIFACTS_PER_RUN} files` }, { status: 409 }, cors);
    }

    const id = crypto.randomUUID();
    const key = artifactKey(businessId, target.runId, id, name);
    const sha256 = await sha256Hex(bytes);
    await env.ARTIFACTS.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { businessId, runId: target.runId, taskId },
    });
    let row;
    try {
      row = await withTenant(env, businessId, (tx) => recordArtifact(tx, businessId, {
        id, runId: target.runId, taskId, name, contentType, size: bytes.byteLength, r2Key: key, sha256,
      }));
    } catch (error) {
      /* No row, no object: an orphan in the bucket is a leak nobody can find. */
      await env.ARTIFACTS.delete(key).catch(() => undefined);
      throw error;
    }
    return json({ ok: true, artifact: artifactJson(row) }, { status: 201 }, cors);
  }

  if (url.pathname === '/api/artifacts' && request.method === 'GET') {
    const identity = await resolveTenant(env, request);
    if (!hasBusiness(identity)) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
    const runIdParam = url.searchParams.get('runId');
    if (runIdParam && !UUID.test(runIdParam)) return json({ ok: false, err: 'runId must be a run id' }, { status: 400 }, cors);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const rows = await withTenant(env, identity.businessId, (tx) => listArtifacts(tx, identity.businessId, {
      runId: runIdParam, limit: Number.isFinite(limit) ? limit : 50, viewer: identity.userId,
    }));
    return json({ ok: true, artifacts: rows.map(artifactJson) }, {}, { ...cors, 'Cache-Control': 'private, no-store' });
  }

  const single = url.pathname.match(/^\/api\/artifacts\/([0-9a-f-]{36})$/i);
  if (single && request.method === 'GET') {
    const identity = await resolveTenant(env, request);
    if (!hasBusiness(identity)) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
    if (!UUID.test(single[1])) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    const row = await withTenant(env, identity.businessId, async (tx) => {
      const found = await getArtifact(tx, identity.businessId, single[1]);
      return found && await runVisibleTo(tx, identity.businessId, found.run_id, identity.userId) ? found : null;
    });
    if (!row) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    if (!env.ARTIFACTS) return json({ ok: false, err: 'artifact storage is not configured' }, { status: 503 }, cors);
    const object = await env.ARTIFACTS.get(row.r2_key);
    if (!object) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    /* Always an attachment, never rendered by the browser at this origin:
       the agent chose the type, and a served HTML or SVG file would run as
       the API. The name is ASCII by construction, so both forms agree. */
    const headers = new Headers({
      ...cors,
      'Content-Type': row.content_type,
      'Content-Length': String(row.size_bytes),
      'Content-Disposition': `attachment; filename="${row.name}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new Response(object.body, { status: 200, headers });
  }

  return null;
}
