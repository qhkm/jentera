/* ============================================================
   Connecting an account, and receiving what it sends.

   The webhook is the first endpoint in this Worker that is not called
   by our own frontend. It is unauthenticated by necessity — Telegram
   has no session — so its only defence is the secret token it must
   present, which is why that check happens before anything else.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import {
  findConnection,
  listConnections,
  markBroken,
  removeConnection,
  saveConnection,
  verifyWebhook,
  useCredential,
  webhookSecret,
} from '../connections';
import {
  clearWebhook,
  parseUpdate,
  sendMessage,
  setWebhook,
  verifyToken,
  webhookHealth,
} from '../connectors/telegram';
import { append, finishRun, recordWork, startRun, updateWorkForRun } from '../runs';
import { answer, retrieve } from '../ask';
import { MODEL } from '../ingest';
import { policyFor } from '../policy';

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

  /* The tenant is in the path, and it has to be.

     RLS is forced on `connection`, so a read with no app.business_id
     set returns nothing — which meant the webhook could never load the
     row it needed to authenticate itself, and every update was dropped
     for want of a secret that was sitting right there. Same shape as
     the business-creation bootstrap: the thing that establishes the
     tenant cannot be read without one.

     Naming the business in the URL is safe because the URL is not the
     authority. It only says which tenant to look inside; the secret
     compared below is what proves the caller is Telegram. A guessed
     business id buys nothing without it. */
  const hook = url.pathname.match(
    /^\/api\/webhooks\/telegram\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i,
  );
  if (hook && request.method === 'POST') {
    return telegramWebhook(request, env, hook[1], hook[2]);
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
      const secret = await withTenant(env, id.businessId, (tx) =>
        webhookSecret(tx, saved.id),
      );
      await setWebhook(token, `${env.API_ORIGIN}/api/webhooks/telegram/${id.businessId}/${saved.id}`, secret);
    } catch (e) {
      const why = e instanceof Error ? e.message : 'webhook setup failed';
      await withTenant(env, id.businessId, (tx) => markBroken(tx, saved.id, why));
      return json({ ok: false, err: why }, { status: 400 }, cors);
    }

    return json({ ok: true, connection: { ...saved, status: 'connected' } }, {}, cors);
  }

  /* ---- is it actually working? ---------------------------------------- */

  const health = url.pathname.match(/^\/api\/connections\/([0-9a-f-]{36})\/health$/i);
  if (health && request.method === 'GET') {
    try {
      const info = await withTenant(env, id.businessId, async (tx) => {
        const token = await useCredential(env, tx, health[1]);
        return webhookHealth(token);
      });
      const expected = `${env.API_ORIGIN}/api/webhooks/telegram/${id.businessId}/${health[1]}`;

      /* A Worker cannot usefully fetch its own custom domain — the
         request loops at the edge and times out with a 522 — so there
         is no self-test here.

         Instead this repairs. A connection whose webhook is pointing
         elsewhere, or which predates the stored secret, is deaf in a
         way the owner cannot see or fix; re-registering costs one call
         and turns "Test" into something that helps rather than just
         reporting bad news. */
      const secretStored = await withTenant(env, id.businessId, async (tx) => {
        const [r] = await tx<{ ok: boolean }[]>`
          select webhook_secret is not null as ok from connection where id = ${health[1]}`;
        return r?.ok ?? false;
      });

      /* A correct URL is not enough. A connection made before the
         secret was stored has the right address and no way to prove an
         update came from Telegram, so every one is refused — the URL
         looks perfect and nothing works. Repair on either fault. */
      let repaired = false;
      if (!info.url || info.url !== expected || !secretStored) {
        await withTenant(env, id.businessId, async (tx) => {
          const token = await useCredential(env, tx, health[1]);
          await setWebhook(token, expected, await webhookSecret(tx, health[1]));
        });
        repaired = true;
      }

      const hasSecret = await withTenant(env, id.businessId, async (tx) => {
        const [r] = await tx<{ ok: boolean }[]>`
          select webhook_secret is not null as ok from connection where id = ${health[1]}`;
        return r?.ok ?? false;
      });

      return json(
        {
          ok: true,
          health: info,
          hasSecret,
          repaired,
          /* Telegram pointing somewhere else is the failure that looks
             like nothing happening at all. */
          pointsHere: info.url === expected,
          expected,
        },
        {},
        cors,
      );
    } catch (e) {
      return json(
        { ok: false, err: e instanceof Error ? e.message : 'could not check' },
        { status: 400 },
        cors,
      );
    }
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
async function telegramWebhook(
  request: Request,
  env: Env,
  businessId: string,
  connectionId: string,
): Promise<Response> {
  const ok = new Response(null, { status: 200 });
  /* Every path here answers 200, which is right for Telegram and awful
     for diagnosis: a dropped update and a handled one look identical
     from outside. So each drop says why, once, in the log. Without
     this the only symptom of a broken webhook is silence. */
  const drop = (why: string) => {
    console.warn(`[telegram] dropped update on ${connectionId}: ${why}`);
    return ok;
  };

  const presented = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';

  /* Scoped to the business named in the URL, which is the only way
     this row is visible at all. Nothing is trusted yet — the secret
     decides. */
  const verdict = await withTenant(env, businessId, (tx) =>
    verifyWebhook(tx, connectionId, presented),
  ).catch((e: unknown) => ({ ok: false as const, why: `lookup failed: ${String(e)}` }));

  if (!verdict.ok) return drop(verdict.why);

  const raw = await request.json().catch(() => null);
  const incoming = parseUpdate(raw);
  if (!incoming) {
    return drop(`unhandled update shape: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  /* Past the secret check, so the business in the URL is confirmed:
     only its own connection could have produced that value. */
  try {
    await handleIncoming(env, businessId, connectionId, incoming);
  } catch (e) {
    /* handleIncoming records its own failures, so reaching here means
       something outside that — the database, the tenant scope. */
    console.error(`[telegram] handling failed on ${connectionId}: ${String(e)}`);
  }
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
    const { facts, policy } = await withTenant(env, businessId, async (tx) => ({
      facts: await retrieve(tx, incoming.text),
      /* Resolved through policy.ts, which is the only place the
         connector's vocabulary and the Permissions screen's meet. */
      policy: await policyFor(tx, 'telegram', 'send_message'),
    }));

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
        /* finishRun writes approval.requested for this status, so
           writing it here too doubled the event. The vocabulary exists
           for later phases to count and compare runs by what happened
           inside them; a duplicate quietly skews every such count. */
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
