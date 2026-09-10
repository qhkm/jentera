/* ============================================================
   The runtime configuration endpoint.

   A sprite asks what it should be configured as, instead of being told at
   bootstrap and then only at the next fleet release. That is the whole
   point: a config change becomes a worker deploy.

   Mounted before request-guard.ts, for the same reason the model proxy is —
   the caller presents a runtime credential rather than a session cookie, so
   the /api guard's CORS and cookie assumptions do not apply.

   Nothing calls this yet. It ships ahead of the runner that will, so that
   the release which starts fetching finds a working endpoint rather than
   the two arriving together.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import { getRuntime } from '../agent-runtime';
import { resolveRuntimeIdentity, RuntimeIdentityError } from '../runtime/identity';
import {
  CONFIG_SCHEMA,
  ConfigSchemaUnsupported,
  renderRuntimeConfig,
} from '../runtime/config-document';
import { listSpecialists } from '../specialists';

export const RUNTIME_CONFIG_PATH = '/v1/runtime/config';

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      /* A configuration document is per-runtime and changes when the control
         plane says so; nothing between here and the sprite may hold a copy. */
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleRuntimeConfig(
  request: Request,
  env: Env,
  url: URL,
  headers: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== RUNTIME_CONFIG_PATH) return null;
  if (request.method !== 'GET') {
    return json({ err: 'runtime config only supports GET' }, 405, headers);
  }

  let identity;
  try {
    identity = await resolveRuntimeIdentity(env, request);
  } catch (err) {
    if (err instanceof RuntimeIdentityError) return json({ err: err.message }, err.status, headers);
    throw err;
  }

  /* Keyed by rider, not IP: sprites share egress addresses, so an IP key
     would let one busy runtime brake the rest. Fails closed like AUTH_BURST. */
  const burst = await env.RUNTIME_CONFIG_BURST.limit({ key: `config:${identity.claims.rid}` });
  if (!burst.success) return json({ err: 'too many config requests' }, 429, headers);

  /* Negotiated, never assumed. A runtime on an older bundle asks for the
     schema it understands; if this worker cannot render it, the runtime keeps
     its last known good rather than being handed something it will reject at
     boot. Stale is a recoverable state; a runtime that will not start is not. */
  const requested = Number(request.headers.get('X-Aisar-Config-Schema') ?? CONFIG_SCHEMA);
  if (!Number.isInteger(requested) || requested < 1) {
    return json({ err: 'schema header is invalid' }, 400, headers);
  }

  const configured = await withTenant(env, identity.businessId, async (tx) => ({
    runtime: await getRuntime(tx, identity.businessId),
    specialists: await listSpecialists(tx, { enabledOnly: true }),
  }));
  const runtime = configured.runtime;
  if (!runtime) return json({ err: 'runtime is not provisioned' }, 403, headers);

  try {
    const document = await renderRuntimeConfig(
      env,
      runtime,
      requested,
      new Date(),
      configured.specialists,
    );
    return json(document, 200, headers);
  } catch (err) {
    if (err instanceof ConfigSchemaUnsupported) {
      return json({ err: 'schema unsupported', supported: CONFIG_SCHEMA }, 409, headers);
    }
    throw err;
  }
}
