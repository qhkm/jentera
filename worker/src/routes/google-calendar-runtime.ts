/* Narrow Calendar tools for a tenant runtime. The runtime can read bounded
   ranges and create approval proposals; only the signed-in owner-facing
   approval route performs the provider mutation. */

import type { Env } from '../env';
import { withTenant } from '../db';
import {
  findConnection,
  markConnectionExpired,
  markConnectionHealthy,
  markConnectionProblem,
  useCredential,
} from '../connections';
import {
  GOOGLE_CALENDAR_CONNECTOR,
  GoogleCalendarError,
  listGoogleCalendarEvents,
  normaliseCalendarEvent,
  normaliseCalendarRange,
} from '../connectors/google-calendar';
import { policyFor } from '../policy';
import { resolveRuntimeIdentity, RuntimeIdentityError } from '../runtime/identity';

export const GOOGLE_CALENDAR_RUNTIME_PATH = '/v1/connectors/google-calendar';

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function noteFailure(env: Env, businessId: string, connectionId: string, error: unknown) {
  const why = error instanceof Error ? error.message : 'Google Calendar could not be reached.';
  await withTenant(env, businessId, (tx) => error instanceof GoogleCalendarError && error.auth
    ? markConnectionExpired(tx, connectionId, why)
    : markConnectionProblem(tx, connectionId, why)).catch(() => {});
}

export async function handleGoogleCalendarRuntime(
  request: Request,
  env: Env,
  url: URL,
  headers: Record<string, string>,
): Promise<Response | null> {
  const eventsPath = `${GOOGLE_CALENDAR_RUNTIME_PATH}/events`;
  const proposalsPath = `${GOOGLE_CALENDAR_RUNTIME_PATH}/proposals`;
  if (url.pathname !== eventsPath && url.pathname !== proposalsPath) return null;

  let identity;
  try {
    identity = await resolveRuntimeIdentity(env, request);
  } catch (error) {
    if (error instanceof RuntimeIdentityError) return json({ ok: false, err: error.message }, error.status, headers);
    throw error;
  }

  const burst = await env.RUNTIME_CONFIG_BURST.limit({ key: `calendar:${identity.claims.rid}` });
  if (!burst.success) return json({ ok: false, err: 'too many calendar requests' }, 429, headers);

  const connected = await withTenant(env, identity.businessId, (tx) =>
    findConnection(tx, GOOGLE_CALENDAR_CONNECTOR));
  if (!connected) {
    return json({
      ok: false,
      code: 'NOT_CONNECTED',
      err: 'Google Calendar is not connected. Ask the owner to connect it in My Business → Connections.',
    }, 409, headers);
  }

  if (url.pathname === eventsPath) {
    if (request.method !== 'GET') return json({ ok: false, err: 'events only supports GET' }, 405, headers);
    let range;
    try {
      range = normaliseCalendarRange(url);
    } catch (error) {
      return json({ ok: false, err: error instanceof Error ? error.message : 'calendar range is invalid' }, 400, headers);
    }
    try {
      const secret = await withTenant(env, identity.businessId, (tx) =>
        useCredential(env, tx, connected.id));
      const events = await listGoogleCalendarEvents(env, secret, range);
      await withTenant(env, identity.businessId, (tx) =>
        markConnectionHealthy(tx, connected.id)).catch(() => {});
      return json({ ok: true, events }, 200, headers);
    } catch (error) {
      await noteFailure(env, identity.businessId, connected.id, error);
      const message = error instanceof Error ? error.message : 'Google Calendar could not be reached.';
      const status = error instanceof GoogleCalendarError && error.auth ? 409 : 502;
      return json({ ok: false, err: message }, status, headers);
    }
  }

  if (request.method !== 'POST') return json({ ok: false, err: 'proposals only supports POST' }, 405, headers);
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(length) && length > 16_384) return json({ ok: false, err: 'calendar proposal is too large' }, 413, headers);
  const raw = await request.text();
  if (raw.length > 16_384) return json({ ok: false, err: 'calendar proposal is too large' }, 413, headers);

  let event;
  try {
    event = normaliseCalendarEvent(JSON.parse(raw));
  } catch (error) {
    return json({
      ok: false,
      err: error instanceof Error ? error.message : 'calendar proposal is invalid',
    }, 400, headers);
  }

  const queued = await withTenant(env, identity.businessId, async (tx) => {
    const policy = await policyFor(tx, GOOGLE_CALENDAR_CONNECTOR, 'create_event');
    if (policy === 'blocked') return { blocked: true as const };
    await tx`select pg_advisory_xact_lock(hashtextextended(
      ${`calendar-proposal:${identity.businessId}:${event.requestId}`}, 0))`;
    const [existing] = await tx<{ id: string; status: string }[]>`
      select id, status from approval
       where connector = ${GOOGLE_CALENDAR_CONNECTOR}
         and op = 'create_event'
         and args->>'requestId' = ${event.requestId}
         and status in ('pending', 'approved', 'executed')
       order by created_at desc limit 1`;
    if (existing) return { blocked: false as const, id: existing.id, duplicate: true, status: existing.status };
    const [created] = await tx<{ id: string }[]>`
      insert into approval (business_id, connector, op, args, risk)
      values (${identity.businessId}, ${GOOGLE_CALENDAR_CONNECTOR}, 'create_event',
              ${tx.json({ ...event, connectionId: connected.id })}, 'medium')
      returning id`;
    return { blocked: false as const, id: created.id, duplicate: false, status: 'pending' };
  });

  if (queued.blocked) {
    return json({ ok: false, code: 'BLOCKED', err: 'Calendar event creation is blocked by the owner.' }, 403, headers);
  }
  const status = queued.status === 'executed'
    ? 'completed'
    : queued.status === 'approved' ? 'working' : 'needs_approval';
  const message = status === 'completed'
    ? 'This event was already added to Google Calendar.'
    : status === 'working'
      ? 'This approved event is being added to Google Calendar.'
      : 'Event drafted. The owner must approve it in Activity before it is added.';
  return json({
    ok: true,
    approvalId: queued.id,
    duplicate: queued.duplicate,
    status,
    message,
  }, queued.duplicate ? 200 : 202, headers);
}
