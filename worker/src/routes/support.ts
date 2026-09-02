/* ============================================================
   Staff support endpoints.

   Authenticated by a Worker secret rather than a session, so
   triage works from a terminal without an owner account.

   The only capability here is minting Telegram owner-pairing
   deep links. That is deliberately narrow: the pairing link is
   the boundary that binds an arbitrary Telegram chat as the
   internal owner chat — full business memory, tools, and paid
   runs become reachable from whoever uses it. Only support may
   hold one, which is why the app strips it for non-owners and
   why this route exists at all.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import {
  findConnectionById,
  listConnections,
  telegramInternalChat,
} from '../connections';
import { telegramPairingCode, telegramPairingUrl } from '../telegram-pairing';
import type { ConnectionRow } from '../connections';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

/** Constant time, same shape as every other secret check in this Worker. */
function keyEquals(expected: string, presented: string): boolean {
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleSupport(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/support')) return null;

  /* AISAR_SUPPORT_KEY is the purpose-built secret. Falling back to the
     OpenRouter management key means the endpoint works on existing
     installs without a new secret — rotate in a dedicated key whenever
     the two should be decoupled. */
  const expected =
    env.AISAR_SUPPORT_KEY?.trim() || env.AISAR_OPENROUTER_MANAGEMENT_KEY?.trim() || '';
  if (!expected) {
    return json(
      { ok: false, err: 'support key is not configured' },
      { status: 503 },
      cors,
    );
  }
  const presented = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!presented || !keyEquals(expected, presented)) {
    return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
  }

  if (url.pathname !== '/api/support/telegram-pairing') {
    return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
  }
  if (request.method !== 'GET') {
    return json({ ok: false, err: 'method not allowed' }, { status: 405 }, cors);
  }

  const businessId = url.searchParams.get('businessId') ?? '';
  if (!UUID.test(businessId)) {
    return json({ ok: false, err: 'businessId is required' }, { status: 400 }, cors);
  }
  const connectionId = url.searchParams.get('connectionId') ?? '';
  if (connectionId && !UUID.test(connectionId)) {
    return json({ ok: false, err: 'invalid connectionId' }, { status: 400 }, cors);
  }

  /* withTenant scopes every read to the named business. A wrong
     businessId for a real connection comes back as "not found", not a
     cross-tenant leak. */
  const connections = await withTenant(env, businessId, async (tx) => {
    if (connectionId) {
      const row = await findConnectionById(tx, connectionId);
      return row ? [await view(env, tx, row)] : [];
    }
    const rows = await listConnections(tx);
    return Promise.all(
      rows.filter((row) => row.connector === 'telegram').map((row) => view(env, tx, row)),
    );
  });

  if (connectionId && connections.length === 0) {
    return json(
      { ok: false, err: 'no such connection for that business' },
      { status: 404 },
      cors,
    );
  }
  return json({ ok: true, businessId, connections }, {}, cors);
}

async function view(
  env: Env,
  tx: Parameters<typeof listConnections>[0],
  row: ConnectionRow,
): Promise<Record<string, unknown>> {
  if (row.connector !== 'telegram') return { ...row };

  const chat = await telegramInternalChat(tx, row.id);
  const paired = chat !== null;
  const code = paired ? null : await telegramPairingCode(env, row.id);
  return {
    ...row,
    paired,
    internalChat: chat,
    /* Once paired, the deep link is a no-op (it cannot rebind), so support
       only ever sees codes for bots that genuinely need pairing. */
    code,
    deepLink: paired ? null : await telegramPairingUrl(env, row.id, row.displayName),
    startCommand: code ? `/start ${code}` : null,
  };
}
