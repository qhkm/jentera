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
  bindTelegramInternalChat,
  findConnection,
  listConnections,
  markBroken,
  removeConnection,
  saveConnection,
  telegramInternalChat,
  verifyWebhook,
  useCredential,
  webhookSecret,
} from '../connections';
import {
  clearWebhook,
  hermesDraftId,
  parseUpdate,
  sendMessage,
  sendTyping,
  sendMessageDraft,
  setWebhook,
  verifyToken,
  webhookHealth,
  withTypingIndicator,
} from '../connectors/telegram';
import { finishRun, recentWork, recordWork, startRun } from '../runs';
import { prepareHermesAgent, retrieve } from '../ask';
import { runtimeFor, signalRuntimeTask } from '../runtime';
import { getRuntime } from '../agent-runtime';
import { enqueueRuntimeTask, runtimeTaskByDedupeKey } from '../runtime/tasks';
import { runtimeExecutionEnabled, runtimeReady } from '../runtime/execution';
import { deliverTelegramDraft, type TelegramIncoming } from '../telegram-delivery';
import { admitPaidAgentRun } from '../request-guard';
import {
  telegramPairingUrl,
  validTelegramPairingCode,
} from '../telegram-pairing';
import type { ConnectionRow } from '../connections';

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
    const rows = await withTenant(env, id.businessId, async (tx) => {
      const connections = await listConnections(tx);
      return Promise.all(connections.map((row) => connectionView(env, tx, row)));
    });
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

    const connection = await withTenant(env, id.businessId, (tx) =>
      connectionView(env, tx, { ...saved, status: 'connected' }));
    return json({ ok: true, connection }, {}, cors);
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

  /* A connected bot is an internal business agent by default. Telegram bot
     usernames are public, so webhook authentication alone proves only that
     Telegram delivered the update—not that its sender owns this business.
     The signed-in owner receives a one-time deep link and claims one private
     chat before any business memory or paid tools become reachable. */
  const pair = incoming.text.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{32})$/);
  if (pair && incoming.privateChat &&
      await validTelegramPairingCode(env, connectionId, pair[1])) {
    const bound = await withTenant(env, businessId, (tx) =>
      bindTelegramInternalChat(tx, connectionId, incoming.chatId));
    if (bound === 'paired' || bound === 'already_paired') {
      const token = await withTenant(env, businessId, (tx) =>
        useCredential(env, tx, connectionId));
      await sendMessage(
        token,
        incoming.chatId,
        'Jentera is connected to your business. Ask me about your operations, research, planning, or anything you need to get done.',
      ).catch(() => {});
      return ok;
    }
    return drop(`pairing refused: ${bound}`);
  }

  const internalChat = await withTenant(env, businessId, (tx) =>
    telegramInternalChat(tx, connectionId));
  if (internalChat !== incoming.chatId || !incoming.privateChat) {
    /* Silence made a secure pairing boundary look like a broken or very slow
       agent. A private, unpaired sender may receive setup guidance, but never
       business identity, memory, tools, or a paid model run. */
    if (incoming.privateChat) {
      const token = await withTenant(env, businessId, (tx) =>
        useCredential(env, tx, connectionId));
      await sendMessage(
        token,
        incoming.chatId,
        internalChat === null
          ? 'Jentera is not paired with an owner yet. Open Jentera → My Business → Connections → Open in Telegram, then press Start once.'
          : 'This is a private internal Jentera bot. This Telegram account is not authorised to use it.',
      ).catch(() => {});
    }
    return drop(internalChat === null ? 'internal owner chat is not paired' : 'sender is not paired owner');
  }

  /* This is after Telegram's secret has authenticated the connection, so an
     attacker who merely guesses the webhook URL cannot consume its paid-run
     quota. Both the whole bot and the individual chat have a spend brake. */
  if (!await admitPaidAgentRun(env, [
    `telegram-connection:${connectionId}`,
    `telegram-chat:${connectionId}:${incoming.chatId}`,
  ])) {
    return drop('agent admission limit exceeded');
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

async function connectionView(
  env: Env,
  tx: Parameters<typeof listConnections>[0],
  row: ConnectionRow,
) {
  if (row.connector !== 'telegram') return row;
  const paired = await telegramInternalChat(tx, row.id) !== null;
  return {
    ...row,
    paired,
    pairingUrl: paired ? null : await telegramPairingUrl(env, row.id, row.displayName),
  };
}

export async function handleIncoming(
  env: Env,
  businessId: string,
  connectionId: string,
  incoming: TelegramIncoming,
): Promise<void> {
  if (runtimeExecutionEnabled(env)) {
    const runtime = await withTenant(env, businessId, (tx) => getRuntime(tx, businessId));
    if (runtimeReady(runtime)) {
      await handleDurableIncoming(env, businessId, connectionId, incoming);
      return;
    }
  }

  const runtime = runtimeFor(env, businessId);
  const run = await withTenant(env, businessId, (tx) =>
    startRun(tx, businessId, {
      kind: 'ask',
      triggerShape: 'owner.message.telegram',
      triggerRef: { chatId: incoming.chatId, from: incoming.from },
      runtime: runtime.id,
      model: runtime.model,
    }),
  );

  try {
    const { facts } = await withTenant(env, businessId, async (tx) => ({
      facts: await retrieve(tx, incoming.text),
    }));

    const automaticToken = await withTenant(env, businessId, (tx) =>
      useCredential(env, tx, connectionId));
    const draft = await withTypingIndicator(
      automaticToken,
      incoming.chatId,
      () => runtime.answerQuestion(incoming.text, facts, []),
    );

    await deliverTelegramDraft(
      env,
      businessId,
      connectionId,
      run.id,
      incoming,
      draft.text,
      draft.usedKeys,
      'automatic',
      automaticToken,
    );
  } catch (e) {
    const why = e instanceof Error ? e.message : 'could not reply';
    await withTenant(env, businessId, async (tx) => {
      await recordWork(tx, businessId, {
        runId: run.id,
        objective: `Help ${incoming.from} on Telegram`,
        outcome: why,
        status: 'failed',
        function: 'assistant',
        channel: 'telegram',
        risk: 'medium',
      });
      await finishRun(tx, businessId, run.id, 'failed', { error: why });
    });
  }
}

/** Persist one Telegram update as durable Hermes work and return before the
    model runs. Telegram retries use the same message id and cannot create a
    second paid task. */
async function handleDurableIncoming(
  env: Env,
  businessId: string,
  connectionId: string,
  incoming: TelegramIncoming,
): Promise<void> {
  if (!env.RUNTIME_QUEUE || !env.AISAR_MODEL_NAME?.trim()) {
    throw new Error('durable Telegram execution is unavailable');
  }
  if (!Number.isSafeInteger(incoming.messageId)) {
    throw new Error('Telegram message id is missing');
  }

  const { facts, work } = await withTenant(
    env,
    businessId,
    async (tx) => ({
      facts: await retrieve(tx, incoming.text),
      work: await recentWork(tx, 8),
    }),
  );

  const prepared = prepareHermesAgent(incoming.text, facts, work);
  const dedupeKey = `telegram:${connectionId}:${incoming.chatId}:${incoming.messageId}`;
  const created = await withTenant(env, businessId, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))`;
    const existing = await runtimeTaskByDedupeKey(tx, businessId, dedupeKey);
    if (existing) return existing;

    const run = await startRun(tx, businessId, {
      kind: 'ask',
      triggerShape: 'owner.message.telegram',
      triggerRef: {
        chatId: incoming.chatId,
        messageId: incoming.messageId,
        from: incoming.from,
        question: incoming.text,
      },
      runtime: 'hermes-sprite',
      model: env.AISAR_MODEL_NAME!.trim(),
    });
    return enqueueRuntimeTask(tx, businessId, {
      kind: 'run',
      runId: run.id,
      dedupeKey,
      payload: {
        input: boundedRuntimeInput(prepared.input, incoming.text),
        instructions: prepared.instructions,
        sessionId: run.id,
        objective: `Help ${incoming.from} on Telegram`,
        function: 'assistant',
        channel: 'telegram',
        factKeys: prepared.usedKeys,
        grounded: prepared.grounded,
        telegram: {
          connectionId,
          chatId: incoming.chatId,
          messageId: incoming.messageId,
          from: incoming.from,
          question: incoming.text,
          privateChat: incoming.privateChat === true,
        },
      },
    });
  });

  if (['completed', 'cancelled', 'exhausted'].includes(created.status)) return;
  await signalRuntimeTask(env, businessId, created.id);
  const token = await withTenant(env, businessId, (tx) =>
    useCredential(env, tx, connectionId));
  if (incoming.privateChat) {
    await sendMessageDraft(
      token,
      incoming.chatId,
      hermesDraftId(created.id),
      '',
    ).catch(() => {});
    await sendTyping(token, incoming.chatId).catch(() => {});
  } else {
    await sendTyping(token, incoming.chatId).catch(() => {});
  }
}

function boundedRuntimeInput(input: string, question: string): string {
  const max = 19_500;
  if (input.length <= max) return input;
  const suffix = `\n\nQuestion: ${question}`;
  return `${input.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}
