/* ============================================================
   Run endpoints.

   Ingestion remains a short inline operation. Ask AISAR is also inline
   by default, but an explicit business execution canary persists a
   durable Hermes task and exposes only its tenant-scoped run status to
   the browser. Both paths share the same grounding instructions.
   ============================================================ */

import type { Env } from './../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import {
  append,
  finishRun,
  getRun,
  homeCounters,
  recentWork,
  recordWork,
  runTrace,
  startRun,
} from '../runs';
import { recordFact } from '../facts';
import { urlProblem } from '../ingest';
import { runtimeFor, signalRuntimeTask } from '../runtime';
import { prepareAsk, retrieve } from '../ask';
import { getRuntime } from '../agent-runtime';
import {
  enqueueRuntimeTask,
  runtimeTaskByDedupeKey,
  runtimeTaskForRun,
  type RuntimeTask,
} from '../runtime/tasks';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

export async function handleRuns(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/runs')) return null;

  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }
  const id = identity;

  /* ---- read the business's own website ------------------------------- */

  if (url.pathname === '/api/runs/ingest' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { url?: string };
    const problem = urlProblem(body.url);
    if (problem) return json({ ok: false, err: problem }, { status: 400 }, cors);
    const target = String(body.url).trim();

    const runtime = runtimeFor(env, id.businessId);
    const run = await withTenant(env, id.businessId, (tx) =>
      startRun(tx, id.businessId, {
        kind: 'ingest',
        triggerShape: 'owner.ingest.url',
        triggerRef: { url: target },
        requestedBy: id.userId,
        // Whatever actually ran it, not a hardcoded guess.
        runtime: runtime.id,
        model: runtime.model,
      }),
    );

    try {
      const page = await runtime.readPage(target);
      await withTenant(env, id.businessId, (tx) =>
        append(tx, id.businessId, run.id, 'work.started', {
          url: target,
          title: page.title,
          chars: page.chars,
        }),
      );

      const candidates = page.candidates;

      /* Written as unconfirmed agent facts, each carrying the page it
         came from. A correction later supersedes rather than deletes,
         so re-reading the site next month cannot quietly reinstate
         something the owner already rejected. */
      const written = await withTenant(env, id.businessId, async (tx) => {
        const keys: string[] = [];
        for (const c of candidates) {
          await recordFact(tx, id.businessId, {
            key: c.key,
            value: c.value,
            source: 'agent',
            sourceRef: target,
            confidence: c.confidence,
          });
          keys.push(c.key);
        }
        await append(tx, id.businessId, run.id, 'action.proposed', { facts: keys });
        await recordWork(tx, id.businessId, {
          runId: run.id,
          objective: `Read ${new URL(target).hostname} and learn about the business`,
          outcome:
            keys.length === 0
              ? 'Nothing clear enough to suggest'
              : `Suggested ${keys.length} thing${keys.length === 1 ? '' : 's'} to confirm`,
          status: 'completed',
          function: 'ingest',
          channel: 'web',
          subject: page.title || new URL(target).hostname,
          risk: 'low',
          counters: { facts: keys.length },
          // Reading a site by hand and typing it up is roughly this.
          minutesSaved: keys.length * 2,
          artifacts: [{ kind: 'url', ref: target }],
          inputsUsed: { url: target, chars: page.chars },
        });
        await finishRun(tx, id.businessId, run.id, 'completed', { facts: keys.length });
        return keys;
      });

      /* `chars` goes back too. A JavaScript-rendered page returns a
         shell — jentera.ai is 43 characters of <title> once the scripts
         are stripped — and reporting "found 1 thing" for that reads as
         "I read your site" when nothing of the site was read. */
      return json(
        { ok: true, runId: run.id, facts: written.length, keys: written, chars: page.chars },
        {},
        cors,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'something went wrong';
      await withTenant(env, id.businessId, async (tx) => {
        await recordWork(tx, id.businessId, {
          runId: run.id,
          objective: `Read ${target}`,
          outcome: message,
          status: 'failed',
          function: 'ingest',
          channel: 'web',
          risk: 'low',
        });
        await finishRun(tx, id.businessId, run.id, 'failed', { error: message });
      });
      /* 200 with ok:false — the run genuinely happened and is on
         record; it is the reading that failed, not the request. */
      return json({ ok: false, runId: run.id, err: message }, {}, cors);
    }
  }

  /* ---- ask a question about the business ------------------------------ */

  if (url.pathname === '/api/runs/ask' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      question?: string;
      requestId?: unknown;
    };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return json({ ok: false, err: 'ask me something' }, { status: 400 }, cors);
    if (question.length > 1000) {
      return json({ ok: false, err: 'that question is too long' }, { status: 400 }, cors);
    }
    if (body.requestId !== undefined &&
        (typeof body.requestId !== 'string' || !uuid(body.requestId))) {
      return json({ ok: false, err: 'request id is invalid' }, { status: 400 }, cors);
    }

    if (durableAskEnabled(env, id.businessId)) {
      return startDurableAsk(
        env,
        id.businessId,
        id.userId,
        question,
        typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID(),
        cors,
      );
    }

    const askRuntime = runtimeFor(env, id.businessId);
    const run = await withTenant(env, id.businessId, (tx) =>
      startRun(tx, id.businessId, {
        kind: 'ask',
        triggerShape: 'owner.ask',
        triggerRef: { question },
        requestedBy: id.userId,
        runtime: askRuntime.id,
        model: askRuntime.model,
      }),
    );

    /* Retrieval and recent work are read first, in their own
       transaction, so the model call is not holding a database
       connection open while it thinks. */
    const { facts, work } = await withTenant(env, id.businessId, async (tx) => ({
      facts: await retrieve(tx, question),
      work: await recentWork(tx, 8),
    }));

    await withTenant(env, id.businessId, (tx) =>
      append(tx, id.businessId, run.id, 'fact.retrieved', { keys: facts.map((f) => f.key) }),
    );

    try {
      const result = await askRuntime.answerQuestion(
        question,
        facts,
        work.map((w) => ({ objective: w.objective, outcome: w.outcome })),
      );
      await withTenant(env, id.businessId, async (tx) => {
        await recordWork(tx, id.businessId, {
          runId: run.id,
          objective: question,
          outcome: result.text.slice(0, 500),
          status: 'completed',
          function: 'ask',
          channel: 'app',
          risk: 'low',
          // What it leaned on, so a wrong answer is traceable to a
          // wrong input rather than being unexplainable.
          inputsUsed: { factKeys: result.usedKeys },
        });
        await finishRun(tx, id.businessId, run.id, 'completed', { grounded: result.grounded });
      });
      return json({ ok: true, runId: run.id, ...result }, {}, cors);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'could not answer that';
      await withTenant(env, id.businessId, (tx) =>
        finishRun(tx, id.businessId, run.id, 'failed', { error: message }),
      );
      return json({ ok: false, runId: run.id, err: message }, {}, cors);
    }
  }

  /* ---- what has happened ---------------------------------------------- */

  if (url.pathname === '/api/runs/activity' && request.method === 'GET') {
    const [work, counters] = await withTenant(env, id.businessId, async (tx) => [
      await recentWork(tx, 50),
      await homeCounters(tx),
    ]);
    return json({ ok: true, work, counters }, {}, cors);
  }

  const status = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})$/i);
  if (status && request.method === 'GET') {
    const privateHeaders = { ...cors, 'Cache-Control': 'private, no-store' };
    const state = await withTenant(env, id.businessId, async (tx) => {
      const run = await getRun(tx, id.businessId, status[1]);
      const task = run ? await runtimeTaskForRun(tx, id.businessId, run.id) : null;
      return { run, task };
    });
    if (!state.run) {
      return json({ ok: false, err: 'run not found' }, { status: 404 }, privateHeaders);
    }
    if (!state.task || state.run.runtime !== 'hermes-sprite') {
      return json({
        ok: true,
        runId: state.run.id,
        status: state.run.status,
        pending: !terminalRun(state.run.status),
      }, {}, privateHeaders);
    }
    if (state.run.status === 'completed') {
      const metadata = askMetadata(state.task);
      return json({
        ok: true,
        runId: state.run.id,
        status: 'completed',
        pending: false,
        text: answerText(state.task.result),
        usedKeys: metadata.usedKeys,
        grounded: metadata.grounded,
      }, {}, privateHeaders);
    }
    if (state.run.status === 'failed' || state.run.status === 'cancelled') {
      return json({
        ok: true,
        runId: state.run.id,
        status: state.run.status,
        pending: false,
        err: state.run.status === 'cancelled'
          ? 'AISAR stopped that answer.'
          : 'AISAR could not answer that just now. Please try again.',
      }, {}, privateHeaders);
    }
    return json({
      ok: true,
      runId: state.run.id,
      status: state.run.status,
      pending: true,
    }, {}, privateHeaders);
  }

  const trace = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})\/trace$/i);
  if (trace && request.method === 'GET') {
    const events = await withTenant(env, id.businessId, (tx) => runTrace(tx, trace[1]));
    return json({ ok: true, events }, {}, cors);
  }

  return null;
}

async function startDurableAsk(
  env: Env,
  businessId: string,
  userId: string,
  question: string,
  requestId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.RUNTIME_QUEUE || !env.AISAR_MODEL_NAME?.trim()) {
    return json({ ok: false, err: 'AISAR agent execution is unavailable' }, { status: 503 }, cors);
  }
  const runtime = await withTenant(env, businessId, (tx) => getRuntime(tx, businessId));
  if (!runtime || runtime.observedRelease !== runtime.desiredRelease ||
      !['ready', 'cold', 'idle', 'busy'].includes(runtime.status)) {
    return json({
      ok: false,
      err: 'AISAR is preparing your agent. Please try again shortly.',
    }, { status: 503 }, cors);
  }

  const { facts, work } = await withTenant(env, businessId, async (tx) => ({
    facts: await retrieve(tx, question),
    work: await recentWork(tx, 8),
  }));
  const prepared = prepareAsk(question, facts, work);
  const dedupeKey = `ask:${requestId}`;
  const created = await withTenant(env, businessId, async (tx) => {
    /* The advisory lock makes the HTTP idempotency key atomic with run
       creation. Without it, two simultaneous retries could leave an
       orphan run before the task's unique dedupe constraint wins. */
    await tx`select pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))`;
    const existing = await runtimeTaskByDedupeKey(tx, businessId, dedupeKey);
    if (existing) {
      if (!existing.runId) throw new Error('durable ask task has no run');
      return { runId: existing.runId, task: existing };
    }

    const run = await startRun(tx, businessId, {
      kind: 'ask',
      triggerShape: 'owner.ask',
      triggerRef: { question, requestId },
      requestedBy: userId,
      runtime: 'hermes-sprite',
      model: env.AISAR_MODEL_NAME!.trim(),
    });
    await append(tx, businessId, run.id, 'fact.retrieved', {
      keys: prepared.usedKeys,
    });
    const task = await enqueueRuntimeTask(tx, businessId, {
      kind: 'run',
      runId: run.id,
      dedupeKey,
      payload: {
        input: boundedAskInput(prepared.input, question),
        instructions: prepared.instructions,
        sessionId: run.id,
        objective: question,
        function: 'ask',
        channel: 'app',
        factKeys: prepared.usedKeys,
        grounded: prepared.grounded,
      },
    });
    return { runId: run.id, task };
  });

  /* Sending after commit avoids a message racing an invisible row. If
     delivery fails, the browser can repeat the same requestId: it finds
     this row and safely sends another wake-up signal. */
  try {
    await signalRuntimeTask(env, businessId, created.task.id);
  } catch {
    /* Queue errors are intentionally not interpolated. Provider/library
       exceptions are not a safe logging contract for credentials. */
    console.error('[durable-ask] queue signal failed');
    return json({
      ok: false,
      err: 'AISAR could not queue that answer. Please try again.',
    }, { status: 503 }, cors);
  }
  return json({
    ok: true,
    pending: true,
    status: created.task.status,
    runId: created.runId,
  }, { status: 202 }, cors);
}

function durableAskEnabled(env: Env, businessId: string): boolean {
  return new Set((env.RUNTIME_EXECUTION_BUSINESS_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(uuid)).has(businessId);
}

function boundedAskInput(input: string, question: string): string {
  const max = 19_500;
  if (input.length <= max) return input;
  const suffix = `\n\nQuestion: ${question}`;
  return `${input.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

function askMetadata(task: RuntimeTask): { usedKeys: string[]; grounded: boolean } {
  if (!task.payload || typeof task.payload !== 'object') {
    return { usedKeys: [], grounded: false };
  }
  const payload = task.payload as Record<string, unknown>;
  const usedKeys = Array.isArray(payload.factKeys)
    ? payload.factKeys.filter((key): key is string => typeof key === 'string').slice(0, 24)
    : [];
  return { usedKeys, grounded: payload.grounded === true };
}

function answerText(result: unknown): string {
  if (typeof result === 'string' && result.trim()) return result.trim().slice(0, 20_000);
  if (result && typeof result === 'object') {
    const text = (result as Record<string, unknown>).text;
    if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 20_000);
  }
  return 'AISAR completed the work but returned no readable answer.';
}

function terminalRun(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
