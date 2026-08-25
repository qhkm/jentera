/* ============================================================
   AISAR API — the executor behind the client's tool contract.

   Same shape the client already speaks, so swapping the local mock
   for this Worker changes one environment variable and nothing else.

   The rule the whole product rests on: anything above low risk is
   queued for a human, never executed on the agent's say-so.
   ============================================================ */

import { execute } from './connectors';
import { handleSession } from './routes/session';
import { hasBusiness, resolveTenant } from './tenancy';
import type { Env } from './env';
import {
  decideApproval,
  getApproval,
  listApprovals,
  log,
  queueApproval,
  recordResult,
  type Risk,
} from './store';

/** Mirrors the client's TOOL_RISK table — keep the two in step. */
const TOOL_RISK: Record<string, Risk> = {
  send: 'high',
  pay: 'high',
  cancel: 'high',
  refund: 'high',
  update: 'medium',
  book: 'medium',
  read: 'low',
  list: 'low',
  export: 'low',
};

function riskOf(op: string): Risk {
  return TOOL_RISK[op] ?? 'medium';
}

function cors(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] ?? '',
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

    try {
      /* ---- POST /api/tools/call ---------------------------------- */
      if (url.pathname === '/api/tools/call' && request.method === 'POST') {
        const identity = await resolveTenant(env, request);
        if (!hasBusiness(identity)) {
          return json({ ok: false, err: 'not signed in' }, { status: 401 }, headers);
        }
        const business = identity.businessId;

        const body = (await request.json()) as ToolRequest;
        const conn = body.conn?.trim();
        const op = body.op?.trim();

        if (!conn || !op) {
          return json({ ok: false, err: 'conn and op are required' }, { status: 400 }, headers);
        }

        const args = body.args ?? {};
        const risk = riskOf(op);
        const dry = body.dryRun ?? risk !== 'low';
        const id = crypto.randomUUID();

        // Low-risk reads run straight through; everything else queues.
        if (dry) {
          const queued = await queueApproval(env.DB, { id, business, connector: conn, op, args, risk });
          await log(env.DB, {
            id: crypto.randomUUID(),
            business,
            connector: conn,
            op,
            outcome: 'queued',
            detail: `risk=${risk}`,
          });
          return json({ ok: true, dryRun: true, risk, queued }, {}, headers);
        }

        const result = await execute({ env, business, connector: conn, op, args });
        await log(env.DB, {
          id: crypto.randomUUID(),
          business,
          connector: conn,
          op,
          outcome: result.ok ? 'executed' : 'refused',
          detail: result.detail,
        });
        return json({ ok: result.ok, executed: true, detail: result.detail, ref: result.ref }, {}, headers);
      }

      /* ---- GET /api/approvals?business=…&status=… ---------------- */
      if (url.pathname === '/api/approvals' && request.method === 'GET') {
        const identity = await resolveTenant(env, request);
        if (!hasBusiness(identity)) {
          return json({ ok: false, err: 'not signed in' }, { status: 401 }, headers);
        }
        const business = identity.businessId;
        const status = url.searchParams.get('status') as
          | 'pending'
          | 'approved'
          | 'rejected'
          | null;
        const approvals = await listApprovals(env.DB, business, status ?? undefined);
        return json({ ok: true, approvals }, {}, headers);
      }

      /* ---- POST /api/approvals/:id/decide ------------------------ */
      const decide = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decide$/);
      if (decide && request.method === 'POST') {
        const identity = await resolveTenant(env, request);
        if (!hasBusiness(identity)) {
          return json({ ok: false, err: 'not signed in' }, { status: 401 }, headers);
        }

        const id = decide[1];
        const { approved } = (await request.json()) as { approved?: boolean };

        const changed = await decideApproval(env.DB, id, approved ? 'approved' : 'rejected', identity.businessId);
        if (!changed) {
          // Already decided, or no such row — never execute twice.
          return json({ ok: false, err: 'not pending' }, { status: 409 }, headers);
        }

        if (!approved) {
          return json({ ok: true, status: 'rejected' }, {}, headers);
        }

        const approval = await getApproval(env.DB, id);
        if (!approval) {
          return json({ ok: false, err: 'not found' }, { status: 404 }, headers);
        }

        const result = await execute({
          env,
          business: approval.business,
          connector: approval.connector,
          op: approval.op,
          args: approval.args,
        });

        await recordResult(env.DB, id, result.ok ? 'executed' : 'failed', result);
        await log(env.DB, {
          id: crypto.randomUUID(),
          business: approval.business,
          connector: approval.connector,
          op: approval.op,
          outcome: result.ok ? 'executed' : 'refused',
          detail: result.detail,
        });

        return json(
          { ok: true, status: result.ok ? 'executed' : 'failed', detail: result.detail },
          {},
          headers,
        );
      }

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
