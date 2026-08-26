/* ============================================================
   Connecting an account, and receiving what it sends.

   The webhook is the first endpoint in this Worker that is not called
   by our own frontend. It is unauthenticated by necessity — Telegram
   has no session — so its only defence is the secret token it must
   present, which is why that check happens before anything else.
   ============================================================ */

import type { Env } from '../env';
import { withTenant, withUser } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import {
  findConnection,
  listConnections,
  markBroken,
  removeConnection,
  saveConnection,
  useCredential,
  webhookSecret,
} from '../connections';
import { clearWebhook, parseUpdate, sendMessage, setWebhook, verifyToken } from '../connectors/telegram';
import { append, finishRun, recordWork, startRun, updateWorkForRun } from '../runs';
import { answer, retrieve } from '../ask';
import { MODEL } from '../ingest';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

export async function handleConnect(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  /* ---- the webhook, before any auth ----------------------------------- */

  const hook = url.pathname.match(/^\/api\/webhooks\/telegram\/([0-9a-f-]{36})$/i);
  if (hook && request.method === 'POST') {
    return telegramWebhook(request, env, hook[1]);
  }

  if (!url.pathname.startsWith('/api/connections')) return null;

  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }
  const id = identity;

  if (url.pathname === '/api/connections' && request.method === 'GET') {
    const rows = await withTenant(env, id.businessId, (tx) => listConnections(tx));
    return json({ ok: true, connections: rows }, {}, cors);
  }

  /* ---- connect a Telegram bot ----------------------------------------- */

  if (url.pathname === '/api/connections/telegram' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    /* Shape check before spending a network call, and before the value
       reaches anything that might log it. */
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
      return json(
        { ok: false, err: 'That does not look like a bot token. It should look like 123456789:AA…' },
        { status: 400 },
        cors,
      );
    }

    let bot;
    try {
      bot = await verifyToken(token);
    } catch (e) {
      return json(
        { ok: false, err: e instanceof Error ? e.message : 'Could not reach Telegram' },
        { status: 400 },
        cors,
      );
    }

    const saved = await withTenant(env, id.businessId, (tx) =>
      saveConnection(env, tx, id.businessId, {
        connector: 'telegram',
        method: 'bot_token',
        externalId: String(bot.id),
        displayName: `@${bot.username}`,
        secret: token,
        connectedBy: id.userId,
      }),
    );

    /* Webhook last: the connection has to exist before its id can key
       the secret. A failure here leaves a stored connection that
       receives nothing, which is recoverable by reconnecting — the
       reverse would leave Telegram posting at an id we have no
       credential for. */
    try {
      await setWebhook(
        token,
        `${env.API_ORIGIN}/api/webhooks/telegram/${saved.id}`,
        await webhookSecret(env, saved.id),
      );
    } catch (e) {
      const why = e instanceof Error ? e.message : 'webhook setup failed';
      await withTenant(env, id.businessId, (tx) => markBroken(tx, saved.id, why));
      return json({ ok: false, err: why }, { status: 400 }, cors);
    }

    return json({ ok: true, connection: { ...saved, status: 'connected' } }, {}, cors);
  }

  const drop = url.pathname.match(/^\/api\/connections\/([0-9a-f-]{36})$/i);
  if (drop && request.method === 'DELETE') {
    await withTenant(env, id.businessId, async (tx) => {
      /* Best effort: stop Telegram sending before the row goes. If the
         token is already revoked this fails, and the disconnection
         should still succeed. */
      try {
        const secret = await useCredential(env, tx, drop[1]);
        await clearWebhook(secret);
      } catch {
        /* nothing to clear */
      }
      await removeConnection(tx, drop[1]);
    });
    return new Response(null, { status: 204, headers: cors });
  }

  return null;
}

/* ---- incoming ---------------------------------------------------------- */

/**
 * Handle one Telegram update.
 *
 * Always answers 200, even on failure. Telegram retries a non-2xx, and
 * a message we cannot process is not improved by receiving it again
 * every few seconds for a day.
 */
async function telegramWebhook(request: Request, env: Env, connectionId: string): Promise<Response> {
  const ok = new Response(null, { status: 200 });

  const presented = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  const expected = await webhookSecret(env, connectionId);
  /* Constant time: a byte-by-byte comparison would leak the secret to
     anyone willing to measure enough requests. */
  if (presented.length !== expected.length) return ok;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return ok;

  const incoming = parseUpdate(await request.json().catch(() => null));
  if (!incoming) return ok;

  /* The webhook has no session, so the tenant comes from the
     connection row — the one place a business id may be derived from
     something other than a session, and only because the URL was
     proven authentic above. */
  const owner = await withUser(env, async (sql) => {
    const [row] = await sql<{ business_id: string }[]>`
      select business_id from connection where id = ${connectionId} and status = 'connected'`;
    return row?.business_id ?? null;
  });
  if (!owner) return ok;

  await handleIncoming(env, owner, connectionId, incoming);
  return ok;
}

async function handleIncoming(
  env: Env,
  businessId: string,
  connectionId: string,
  incoming: { chatId: number; from: string; text: string },
): Promise<void> {
  const run = await withTenant(env, businessId, (tx) =>
    startRun(tx, businessId, {
      kind: 'reply',
      triggerShape: 'customer.message.telegram',
      triggerRef: { chatId: incoming.chatId, from: incoming.from },
      runtime: 'worker-inline',
      model: MODEL,
    }),
  );

  try {
    const { facts, policy } = await withTenant(env, businessId, async (tx) => {
      const f = await retrieve(tx, incoming.text);
      const [p] = await tx<{ policy: string }[]>`
        select policy from action_policy where op = 'send_message'`;
      return { facts: f, policy: p?.policy ?? 'approval' };
    });

    const draft = await answer(env, incoming.text, facts, []);

    await withTenant(env, businessId, (tx) =>
      append(tx, businessId, run.id, 'action.proposed', {
        connector: 'telegram',
        op: 'send_message',
        chatId: incoming.chatId,
      }),
    );

    if (policy === 'blocked') {
      await withTenant(env, businessId, async (tx) => {
        await recordWork(tx, businessId, {
          runId: run.id,
          objective: `Reply to ${incoming.from} on Telegram`,
          outcome: 'Blocked by your settings — nothing was sent',
          status: 'blocked',
          function: 'reply',
          channel: 'telegram',
          subject: incoming.text.slice(0, 200),
          risk: 'medium',
        });
        await finishRun(tx, businessId, run.id, 'cancelled', { reason: 'blocked' });
      });
      return;
    }

    if (policy !== 'automatic') {
      /* The default. A reply to a customer is a real external effect
         in the business's name, so it waits for a person unless the
         owner has explicitly said otherwise. */
      await withTenant(env, businessId, async (tx) => {
        const [appr] = await tx<{ id: string }[]>`
          insert into approval (business_id, connector, op, args, risk)
          values (${businessId}, 'telegram', 'send_message',
                  ${tx.json({
                    chatId: incoming.chatId,
                    connectionId,
                    from: incoming.from,
                    question: incoming.text,
                    draft: draft.text,
                  } as never)}, 'medium')
          returning id`;
        await append(tx, businessId, run.id, 'approval.requested', { approvalId: appr.id });
        await recordWork(tx, businessId, {
          runId: run.id,
          objective: `Reply to ${incoming.from} on Telegram`,
          outcome: 'Waiting for you to approve the reply',
          status: 'needs_approval',
          function: 'reply',
          channel: 'telegram',
          subject: incoming.text.slice(0, 200),
          risk: 'medium',
          approvalId: appr.id,
          inputsUsed: { factKeys: draft.usedKeys },
        });
        await finishRun(tx, businessId, run.id, 'needs_approval', { approvalId: appr.id });
      });
      return;
    }

    await sendAndRecord(env, businessId, connectionId, run.id, incoming, draft.text, draft.usedKeys);
  } catch (e) {
    const why = e instanceof Error ? e.message : 'could not reply';
    await withTenant(env, businessId, async (tx) => {
      await recordWork(tx, businessId, {
        runId: run.id,
        objective: `Reply to ${incoming.from} on Telegram`,
        outcome: why,
        status: 'failed',
        function: 'reply',
        channel: 'telegram',
        risk: 'medium',
      });
      await finishRun(tx, businessId, run.id, 'failed', { error: why });
    });
  }
}

/** Send, and record that it happened. Shared by the automatic path and
    the approval path, so both leave identical evidence. */
export async function sendAndRecord(
  env: Env,
  businessId: string,
  connectionId: string,
  runId: string,
  incoming: { chatId: number; from: string; text: string },
  text: string,
  usedKeys: string[],
): Promise<void> {
  const token = await withTenant(env, businessId, (tx) => useCredential(env, tx, connectionId));
  const sent = await sendMessage(token, incoming.chatId, text);

  await withTenant(env, businessId, async (tx) => {
    await append(tx, businessId, runId, 'action.executed', {
      connector: 'telegram',
      messageId: sent.messageId,
    });
    /* Update the row the approval pause already wrote, if there is
       one. Only an automatic send has no prior record to amend. */
    const amended = await updateWorkForRun(tx, businessId, runId, {
      status: 'completed',
      outcome: text,
      // Answering a customer by hand, found and typed.
      minutesSaved: 3,
    });
    if (!amended) {
      await recordWork(tx, businessId, {
        runId,
        objective: `Reply to ${incoming.from} on Telegram`,
        outcome: text.slice(0, 500),
        status: 'completed',
        function: 'reply',
        channel: 'telegram',
        subject: incoming.text.slice(0, 200),
        risk: 'medium',
        minutesSaved: 3,
        inputsUsed: { factKeys: usedKeys },
      });
    }
    await tx`update connection set last_ok_at = now() where id = ${connectionId}`;
    await finishRun(tx, businessId, runId, 'completed', { messageId: sent.messageId });
  });
}
