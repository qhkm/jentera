import type { Env } from '../env';
import { can } from '../permissions';
import { hasBusiness, resolveTenant } from '../tenancy';
import { callVault, VaultUnavailable } from '../vault/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface VaultApproval {
  id: string;
  secretId: string;
  taskId: string;
  resource: string;
  operations: string[];
  issuedTo: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  requestedAt: string;
  requestedBy: string;
  decidedAt: string | null;
  decidedBy: string | null;
  expiresAt: string;
  consumedAt: string | null;
}

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      ...headers,
      ...(init.headers ?? {}),
    },
  });
}

/** Owner-facing, material-free bridge to the isolated vault. */
export async function handleVault(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/vault')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }

  const read = url.pathname.match(/^\/api\/vault\/approvals\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && read && UUID.test(read[1]!)) {
    try {
      const upstream = await callVault<{ ok: boolean; approval?: VaultApproval; err?: string }>(
        env,
        `/v1/approvals/${read[1]}?businessId=${encodeURIComponent(identity.businessId)}`,
      );
      if (upstream.status === 404) {
        return json({ ok: false, err: 'approval not found' }, { status: 404 }, cors);
      }
      if (upstream.status !== 200 || !upstream.body.approval) {
        return json({ ok: false, err: 'secure approval is unavailable' }, { status: 502 }, cors);
      }
      const approval = upstream.body.approval;
      return json({
        ok: true,
        approval: {
          id: approval.id,
          reason: approval.reason,
          resource: approval.resource,
          operations: approval.operations,
          status: approval.status,
          requestedAt: approval.requestedAt,
          expiresAt: approval.expiresAt,
          decidedAt: approval.decidedAt,
        },
      }, {}, cors);
    } catch (err) {
      if (err instanceof VaultUnavailable) {
        return json({ ok: false, err: err.message }, { status: 503 }, cors);
      }
      throw err;
    }
  }

  const decide = url.pathname.match(/^\/api\/vault\/approvals\/([0-9a-f-]{36})\/decide$/i);
  if (request.method === 'POST' && decide && UUID.test(decide[1]!)) {
    if (!can(identity, 'approvals.decide')) {
      return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    }
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

    try {
      const upstream = await callVault<{ ok: boolean; approval?: VaultApproval; err?: string }>(
        env,
        `/v1/approvals/${decide[1]}/decide`,
        {
          method: 'POST',
          body: {
            businessId: identity.businessId,
            decision,
            decidedBy: identity.userId,
          },
        },
      );
      if (upstream.status === 400 || upstream.status === 404) {
        return json({ ok: false, err: 'approval is no longer pending' }, { status: 409 }, cors);
      }
      if (upstream.status !== 200 || !upstream.body.approval) {
        return json({ ok: false, err: 'secure approval is unavailable' }, { status: 502 }, cors);
      }
      return json({
        ok: true,
        approval: {
          id: upstream.body.approval.id,
          status: upstream.body.approval.status,
          decidedAt: upstream.body.approval.decidedAt,
        },
      }, {}, cors);
    } catch (err) {
      if (err instanceof VaultUnavailable) {
        return json({ ok: false, err: err.message }, { status: 503 }, cors);
      }
      throw err;
    }
  }

  return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
}
