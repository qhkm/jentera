/* ============================================================
   POST /v1/runtime/connector — the agent asks the control plane to use
   one of the owner's connected services on its behalf.

   This is the seam `connectors.ts` was written for and has been missing a
   caller to. It exists so a connector's credential never has to reach the
   sprite: the agent names a connector and an operation, the Worker holds
   the secret, makes the call, and hands back a sentence. A Bukku token
   opens quotations, invoices, payments and every customer record, and
   `runtime-credentials.ts` explains why such a thing must not sit on a
   machine whose agent reads arbitrary web pages.

   The tenant comes from the runtime credential and from nothing else. No
   field of this request selects a business — that was the hole the
   tenancy model was rebuilt to close.

   Low-risk reads only, for now. `risk.ts` scores `read`, `list` and
   `export` as low and everything else at least medium, and an action that
   needs an owner's decision needs somewhere for the agent to wait while
   they make it. That machinery exists for Hermes-native approvals and is
   not wired to this path, so anything above low is refused here rather
   than executed unapproved or queued into silence.
   ============================================================ */
import type { Env } from '../env';
import { withTenant } from '../db';
import { append } from '../runs';
import { EXECUTORS, execute } from '../connectors';
import { riskOf } from '../risk';
import { resolveRuntimeIdentity, RuntimeIdentityError } from '../runtime/identity';

export const RUNTIME_CONNECTOR_PATH = '/v1/runtime/connector';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Long enough for a search term or a filter, short enough that the body
    cannot become a channel for something else. */
const MAX_ARGS_BYTES = 4_096;

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

interface ConnectorRequest {
  connector?: unknown;
  op?: unknown;
  args?: unknown;
  runId?: unknown;
}

export async function handleRuntimeConnector(
  request: Request,
  env: Env,
  url: URL,
  headers: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== RUNTIME_CONNECTOR_PATH) return null;
  if (request.method !== 'POST') {
    return json({ ok: false, err: 'this endpoint only accepts POST' }, 405, headers);
  }

  let identity;
  try {
    identity = await resolveRuntimeIdentity(env, request);
  } catch (err) {
    if (err instanceof RuntimeIdentityError) return json({ ok: false, err: err.message }, err.status, headers);
    throw err;
  }

  /* Keyed by rider for the same reason the config route is: sprites share
     egress addresses, so an IP key would let one busy runtime brake the rest. */
  const burst = await env.RUNTIME_MUTATION_BURST.limit({ key: `connector:${identity.claims.rid}` });
  if (!burst.success) return json({ ok: false, err: 'too many connector requests' }, 429, headers);

  const body = (await request.json().catch(() => null)) as ConnectorRequest | null;
  const connector = typeof body?.connector === 'string' ? body.connector.trim() : '';
  const op = typeof body?.op === 'string' ? body.op.trim().toLowerCase() : '';
  if (!connector || !op) {
    return json({ ok: false, err: 'connector and op are required' }, 400, headers);
  }
  if (!Object.hasOwn(EXECUTORS, connector)) {
    /* Names what is available rather than only refusing: the caller is an
       agent, and a list it can act on beats a sentence it cannot. */
    return json({
      ok: false,
      err: `No connector called “${connector}”.`,
      connectors: Object.keys(EXECUTORS),
    }, 400, headers);
  }

  const risk = riskOf(op);
  if (risk === 'blocked') {
    return json({ ok: false, err: `${op} is not available to the agent.`, code: 'blocked' }, 403, headers);
  }
  if (risk !== 'low') {
    return json({
      ok: false,
      code: 'needs_approval',
      err: `${op} needs the owner's approval, which cannot be asked for from here yet. ` +
        'Tell the owner what you would do and let them decide.',
    }, 403, headers);
  }

  const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args)
    ? body.args as Record<string, unknown>
    : {};
  if (JSON.stringify(args).length > MAX_ARGS_BYTES) {
    return json({ ok: false, err: 'args are too large' }, 413, headers);
  }

  const result = await execute({ env, business: identity.businessId, connector, op, args });

  /* The owner can see that their books were read, and by which run. The
     trace records the request, never the answer: a list of who owes money
     belongs in the reply the owner asked for, not in an audit row. */
  const runId = typeof body?.runId === 'string' && UUID.test(body.runId) ? body.runId : null;
  if (runId) {
    await withTenant(env, identity.businessId, async (tx) => {
      /* Ownership, not a person's visibility: the caller is the business's
         own runtime, and RLS has already scoped this transaction to it. An
         id for someone else's run simply matches nothing. */
      const [own] = await tx<{ id: string }[]>`select id from run where id = ${runId}`;
      if (!own) return;
      await append(tx, identity.businessId, runId, 'action.executed', {
        connector, op, ok: result.ok,
        resource: typeof args.resource === 'string' ? args.resource : undefined,
      });
    }).catch(() => undefined);
  }

  return json(result.ok
    ? { ok: true, detail: result.detail, ...(result.ref ? { ref: result.ref } : {}) }
    : { ok: false, err: result.detail }, result.ok ? 200 : 422, headers);
}
