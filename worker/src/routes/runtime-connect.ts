/* ============================================================
   POST /v1/runtime/connect — the agent helping an owner set up a service.

   Three steps, and the owner is in all of them:

     { service }                     what this service offers, and what each
                                     way grants, for the owner to choose
     { service, method }             what happens next; for `browser`, where
                                     to sign in
     { service, method, step:'finish' }
                                     read what the owner's sign-in made
                                     available, prove it, store it

   Nothing here completes without the owner. `api_token` ends at a form they
   fill; `browser` cannot read anything until they have signed in and hold
   browser control, which the runner enforces. So an agent that decides on
   its own to connect something reaches a step it cannot take, rather than a
   credential.

   The credential does not pass through the agent. On a sprite that is
   hygiene rather than a boundary — the agent shares that browser and could
   read the page itself. It is recorded as such in the design note, not
   dressed up as protection.
   ============================================================ */
import type { Env } from '../env';
import { withTenant } from '../db';
import { getRuntimeAccess } from '../agent-runtime';
import { saveConnection } from '../connections';
import { connectMethods, connectorNamed, supportsConnectMethod } from '../connect-methods';
import { tokenConnector } from '../token-connectors';
import { resolveRuntimeIdentity, RuntimeIdentityError } from '../runtime/identity';

export const RUNTIME_CONNECT_PATH = '/v1/runtime/connect';
const HARVEST_TIMEOUT_MS = 30_000;

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Where the owner signs in, from what they have already told us. Bukku is
    per-company, so the subdomain is theirs and we cannot invent it. */
function signInUrl(connector: string, account: string): string | null {
  if (connector !== 'Bukku') return null;
  return /^[a-z0-9][a-z0-9-]{1,38}$/i.test(account) ? `https://${account.toLowerCase()}.bukku.my/` : null;
}

interface ConnectRequest {
  service?: unknown;
  method?: unknown;
  step?: unknown;
  account?: unknown;
}

export async function handleRuntimeConnect(
  request: Request,
  env: Env,
  url: URL,
  headers: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== RUNTIME_CONNECT_PATH) return null;
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
  const burst = await env.RUNTIME_MUTATION_BURST.limit({ key: `connect:${identity.claims.rid}` });
  if (!burst.success) return json({ ok: false, err: 'too many setup requests' }, 429, headers);

  const body = (await request.json().catch(() => null)) as ConnectRequest | null;
  const connector = connectorNamed(typeof body?.service === 'string' ? body.service : '');
  if (!connector) {
    return json({ ok: false, err: 'Jentera cannot set that one up yet.' }, 400, headers);
  }
  const offers = connectMethods(connector);

  /* Step one: what this service offers. The agent reads these to the owner
     and asks which they would like. */
  const method = typeof body?.method === 'string' ? body.method : '';
  if (!method) return json({ ok: true, service: connector, choose: offers }, 200, headers);
  if (!supportsConnectMethod(connector, method)) {
    return json({ ok: false, err: `${connector} cannot be connected that way.`, choose: offers }, 400, headers);
  }

  /* Step two, `api_token`: the owner does this one themselves, in the app.
     Saying so is the whole response — there is nothing for the agent to
     carry, and a token must never travel through a chat message. */
  if (method === 'api_token') {
    const entry = tokenConnector(connector);
    return json({
      ok: true,
      service: connector,
      method,
      action: 'open_connections',
      instructions: entry?.account
        ? `Open Connections, choose ${connector}, and paste the token along with the ${entry.account.label.toLowerCase()}.`
        : `Open Connections, choose ${connector}, and paste the token.`,
      /* Said to the agent so it does not helpfully offer to take it. */
      note: 'Never ask the owner to paste a token into the chat. It belongs in the form.',
    }, 200, headers);
  }

  const account = typeof body?.account === 'string' ? body.account.trim() : '';
  const step = typeof body?.step === 'string' ? body.step : 'start';

  if (step !== 'finish') {
    const where = signInUrl(connector, account);
    if (!where) {
      return json({
        ok: false,
        service: connector, method,
        need: 'account',
        err: `Ask the owner for their ${connector} address — the name in front of .bukku.my — then try again.`,
      }, 400, headers);
    }
    return json({
      ok: true, service: connector, method,
      action: 'open_browser', url: where,
      instructions: `Open ${connector} in the business browser and ask the owner to sign in. `
        + 'When they say they have, call this again with step "finish". Do not type their password.',
    }, 200, headers);
  }

  /* Step three: read what the sign-in made available. The runner refuses
     unless the owner holds browser control and is on that service. */
  const { runtime, secrets } = await withTenant(env, identity.businessId, (tx) =>
    getRuntimeAccess(env, tx, identity.businessId));
  if (!runtime.providerUrl || runtime.provider !== 'fly-sprite' || !env.SPRITES_TOKEN) {
    return json({ ok: false, err: 'The business browser is not available.' }, 503, headers);
  }
  const endpoint = new URL('/v1/browser', runtime.providerUrl);
  if (endpoint.protocol !== 'https:') return json({ ok: false, err: 'The business browser is not available.' }, 503, headers);

  let fields: { token?: string; subdomain?: string };
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(HARVEST_TIMEOUT_MS),
      headers: {
        'X-Aisar-Runner-Key': secrets.runnerKey,
        Authorization: `Bearer ${env.SPRITES_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'harvest', connector: connector.toLowerCase() }),
    });
    if (!upstream.ok) {
      const problem = await upstream.json().catch(() => ({})) as { error?: string };
      /* The runner's refusals are about the owner, so they are answered in
         terms the owner can act on rather than relayed as codes. */
      const err = problem.error === 'browser_not_signed_in'
        ? `Ask the owner to sign in to ${connector} in the business browser first.`
        : problem.error === 'browser_controlled' || problem.error === 'browser_control_expired'
          ? 'Ask the owner to take control of the business browser, then try again.'
          : `Jentera could not read the ${connector} settings page. The owner can paste a token instead.`;
      return json({ ok: false, service: connector, method, err }, 409, headers);
    }
    ({ fields = {} } = await upstream.json() as { fields?: { token?: string; subdomain?: string } });
  } catch {
    return json({ ok: false, err: 'The business browser did not respond.' }, 503, headers);
  }

  /* Proved before it is stored, by the same verifier the form uses: a
     credential nobody has exercised is a connection the owner believes in
     and a failure they meet later. */
  const entry = tokenConnector(connector);
  if (!entry || !fields.token || !fields.subdomain) {
    return json({ ok: false, err: `Jentera did not find usable ${connector} settings.` }, 409, headers);
  }
  let verified;
  try {
    verified = await entry.verify(fields.token, fields.subdomain);
  } catch (e) {
    return json({
      ok: false, service: connector, method,
      err: e instanceof Error ? e.message : `${connector} refused those settings.`,
    }, 409, headers);
  }

  const connection = await withTenant(env, identity.businessId, async (tx) => {
    /* Attributed to the owner whose sign-in made it possible, not to the
       runtime. `connected_by` is what the audit reads, and "a sprite did
       it" would be true of the mechanism and false about the decision. */
    const [owner] = await tx<{ user_id: string }[]>`
      select user_id from membership where role = 'owner' order by created_at limit 1`;
    return saveConnection(env, tx, identity.businessId, {
      connector, method: 'api_token',
      externalId: verified.externalId, displayName: verified.displayName,
      secret: fields.token!, connectedBy: owner?.user_id ?? '',
    });
  });
  /* The agent is told it worked and which company, and nothing else. */
  return json({
    ok: true, service: connector, method, connected: verified.displayName, id: connection.id,
  }, 200, headers);
}
