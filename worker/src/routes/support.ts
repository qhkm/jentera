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
  useCredential,
} from '../connections';
import { sendHermesMessage } from '../connectors/telegram';
import { sendNotice } from '../email';
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

  if (url.pathname === '/api/support/announce') {
    if (request.method !== 'POST') {
      return json({ ok: false, err: 'method not allowed' }, { status: 405 }, cors);
    }
    return announce(request, env, cors);
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

/* ---- one-off notices to owners ------------------------------------- */

type AnnounceOutcome = 'sent' | 'would_send' | 'no_paired_chat' | 'no_owner_email' | 'error';

interface AnnounceResult {
  businessId: string;
  channel: 'telegram' | 'email';
  target: string | null;
  outcome: AnnounceOutcome;
}

/**
 * Send one message to the owners of the named businesses, over their paired
 * Telegram owner chat or their account email. Businesses are named
 * explicitly and each is read inside its own tenant scope: support cannot
 * enumerate tenants from here, and a wrong id yields "no target", never a
 * cross-tenant send. `dryRun` lists targets without sending.
 */
async function announce(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, err: 'invalid JSON' }, { status: 400 }, cors);
  }
  const businessIds = Array.isArray(body.businessIds) ? body.businessIds : [];
  if (businessIds.length === 0 || businessIds.length > 200 ||
      !businessIds.every((id) => typeof id === 'string' && UUID.test(id))) {
    return json({ ok: false, err: 'businessIds must be 1-200 UUIDs' }, { status: 400 }, cors);
  }
  const channel = body.channel === 'telegram' || body.channel === 'email' ? body.channel : null;
  if (!channel) return json({ ok: false, err: 'channel must be telegram or email' }, { status: 400 }, cors);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 4_000) {
    return json({ ok: false, err: 'text must be 1-4000 characters' }, { status: 400 }, cors);
  }
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (channel === 'email' && (!subject || subject.length > 200)) {
    return json({ ok: false, err: 'subject is required for email' }, { status: 400 }, cors);
  }
  const dryRun = body.dryRun === true;

  const results: AnnounceResult[] = [];
  for (const businessId of businessIds as string[]) {
    if (channel === 'telegram') {
      const chats = await withTenant(env, businessId, async (tx) => {
        const rows = (await listConnections(tx))
          .filter((row) => row.connector === 'telegram' && row.status === 'connected');
        const found: { connectionId: string; chatId: number }[] = [];
        for (const row of rows) {
          const chatId = await telegramInternalChat(tx, row.id);
          if (chatId !== null) found.push({ connectionId: row.id, chatId });
        }
        return found;
      });
      if (chats.length === 0) {
        results.push({ businessId, channel, target: null, outcome: 'no_paired_chat' });
        continue;
      }
      for (const chat of chats) {
        const target = `chat:${chat.chatId}`;
        if (dryRun) {
          results.push({ businessId, channel, target, outcome: 'would_send' });
          continue;
        }
        try {
          const token = await withTenant(env, businessId, (tx) =>
            useCredential(env, tx, chat.connectionId));
          await sendHermesMessage(token, chat.chatId, text);
          results.push({ businessId, channel, target, outcome: 'sent' });
        } catch (error) {
          console.error(`[support] announce to ${businessId} ${target} failed: ${String(error)}`);
          results.push({ businessId, channel, target, outcome: 'error' });
        }
      }
      continue;
    }

    const emails = await withTenant(env, businessId, async (tx) => {
      const rows = await tx<{ email: string }[]>`
        select u.email from membership m join app_user u on u.id = m.user_id
         where m.business_id = ${businessId} and m.role = 'owner'
         order by u.email`;
      return rows.map((row) => row.email);
    });
    if (emails.length === 0) {
      results.push({ businessId, channel, target: null, outcome: 'no_owner_email' });
      continue;
    }
    for (const email of emails) {
      const target = `email:${email}`;
      if (dryRun) {
        results.push({ businessId, channel, target, outcome: 'would_send' });
        continue;
      }
      const sent = await sendNotice(env, email, subject, text).catch((error) => {
        console.error(`[support] announce to ${businessId} ${target} failed: ${String(error)}`);
        return false;
      });
      results.push({ businessId, channel, target, outcome: sent ? 'sent' : 'error' });
    }
  }
  return json({ ok: true, dryRun, results }, {}, cors);
}
