/* ============================================================
   Run endpoints.

   Ingestion remains a short inline operation. Ask Jentera is also inline
   by default, but explicit business agent work persists a
   durable Hermes task and exposes only its tenant-scoped run status to
   the browser. Both paths share the same grounding instructions.
   ============================================================ */

import type { Env } from './../env';
import { taskAssessmentForRun } from '../task-outcome';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import {
  append,
  finishRun,
  getRun,
  homeCounters,
  rateWork,
  recentWork,
  recordWork,
  runTrace,
  startRun,
  runSteps,
} from '../runs';
import { recordFact } from '../facts';
import { urlProblem } from '../ingest';
import { runtimeFor, signalRuntimeTask } from '../runtime';
import { INLINE_SAFETY_NET_SECONDS, runInlineSlice } from '../runtime/inline-slice';
import type { BackgroundContext, InlineSliceOptions } from '../runtime/inline-slice';
import {
  boundedAgentInput,
  prepareAsk,
  prepareHermesAgent,
  retrieve,
  retrieveHermesContext,
} from '../ask';
import { getRuntime } from '../agent-runtime';
import {
  enqueueRuntimeTask,
  runtimeTaskByDedupeKey,
  runtimeTaskForRun,
  runtimeApprovalFromTask,
  type RuntimeTask,
} from '../runtime/tasks';
import { publishRunProgressSafely } from '../runtime/progress';
import { isFailureNotice } from '../runtime/failure-notice';
import { artifactsForRun } from '../artifacts';
import { runtimeExecutionEnabled, runtimeReady } from '../runtime/execution';
import { modelForResponseMode, responseModeFor } from '../runtime/response-mode';
import type { ResponseMode } from '../runtime/response-mode';
import { listSpecialists, specialistProfileForRequest } from '../specialists';

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
  ctx?: BackgroundContext,
  inline?: InlineSliceOptions,
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
        {
          ok: true,
          runId: run.id,
          facts: written.length,
          keys: written,
          chars: page.chars,
          suggestions: candidates.map(({ key, value, confidence }) => ({ key, value, confidence })),
        },
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
      mode?: unknown;
      sessionId?: unknown;
      responseMode?: unknown;
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
    const sessionId = body.sessionId === undefined ? undefined
      : typeof body.sessionId === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(body.sessionId)
        ? body.sessionId
        : null;
    if (sessionId === null) {
      return json({ ok: false, err: 'session id is invalid' }, { status: 400 }, cors);
    }
    const mode = body.mode ?? 'work';
    if (mode !== 'ask' && mode !== 'work') {
      return json({ ok: false, err: 'ask mode is invalid' }, { status: 400 }, cors);
    }
    if (body.responseMode !== undefined && body.responseMode !== 'quick' && body.responseMode !== 'deep') {
      return json({ ok: false, err: 'response mode is invalid' }, { status: 400 }, cors);
    }
    const responseMode = body.responseMode as ResponseMode | undefined;

    if (mode === 'work') {
      if (!runtimeExecutionEnabled(env)) {
        return json({ ok: false, err: 'Jentera agent work is not available yet' }, { status: 403 }, cors);
      }
      return startDurableAsk(
        env,
        id.businessId,
        id.userId,
        question,
        typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID(),
        cors,
        sessionId,
        responseMode,
        ctx,
        inline,
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
      work: await recentWork(tx, 8, { kind: 'work' }),
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
      /* Conversation stays on the run history and in the ledger; Activity
         is the list of things Jentera did. */
      await recentWork(tx, 50, { kind: 'work' }),
      await homeCounters(tx),
    ]);
    return json({ ok: true, work, counters }, {}, cors);
  }

  /* ---- owner feedback on completed work -------------------------------- */

  if (url.pathname === '/api/runs/quality' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const workId = typeof body.workId === 'string' ? body.workId.trim() : '';
    const quality = body.quality;
    if (!workId) {
      return json({ ok: false, err: 'workId is required' }, { status: 400 }, cors);
    }
    if (quality !== 'good' && quality !== 'poor') {
      return json({ ok: false, err: 'quality must be good or poor' }, { status: 400 }, cors);
    }
    const rated = await withTenant(env, id.businessId, (tx) =>
      rateWork(tx, id.businessId, workId, quality),
    );
    if (!rated) {
      return json({ ok: false, err: 'work record not found' }, { status: 404 }, cors);
    }
    return json({ ok: true }, {}, cors);
  }

  const review = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})\/review$/i);
  if (review && request.method === 'POST') {
    if (id.role !== 'owner') return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    if (!request.headers.get('Origin') || request.headers.get('Origin') !== cors['Access-Control-Allow-Origin']) {
      return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    }
    const body = await request.json().catch(() => null) as { decision?: string } | null;
    if (body?.decision !== 'confirm') return json({ ok: false, err: 'confirm decision required' }, { status: 400 }, cors);
    const confirmed = await withTenant(env, id.businessId, async (tx) => {
      const [run] = await tx<{ status: string }[]>`select status from run
        where id = ${review[1]} and business_id = ${id.businessId} for update`;
      if (run?.status !== 'completed') return false;
      const rows = await tx`update work_record set status = 'completed', updated_at = now()
        where business_id = ${id.businessId} and run_id = ${review[1]}
          and kind = 'work' and status = 'needs_review' returning id`;
      if (!rows.length) return false;
      await append(tx, id.businessId, review[1], 'outcome.observed', {
        assessmentVersion: 1, kind: 'work', status: 'completed',
        source: 'owner.review', reviewedBy: id.userId,
      });
      return true;
    });
    return json({ ok: confirmed, ...(!confirmed ? { err: 'Task is no longer awaiting review. Refresh to check its status.' } : {}) }, { status: confirmed ? 200 : 409 }, cors);
  }

  const status = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})$/i);
  if (status && request.method === 'GET') {
    const privateHeaders = { ...cors, 'Cache-Control': 'private, no-store' };
    const state = await withTenant(env, id.businessId, async (tx) => {
      const run = await getRun(tx, id.businessId, status[1]);
      const task = run ? await runtimeTaskForRun(tx, id.businessId, run.id) : null;
      const [context] = run ? await tx<{ sessionId: string | null }[]>`select trigger_ref->>'sessionId' as "sessionId"
        from run where business_id = ${id.businessId} and id = ${run.id}` : [];
      return { run, task, sessionId: context?.sessionId ?? undefined };
    });
    if (!state.run) {
      return json({ ok: false, err: 'run not found' }, { status: 404 }, privateHeaders);
    }
    if (!state.task || state.run.runtime !== 'hermes-sprite') {
      /* Deterministic work (routines) has no runtime task; its readable
         result is the work record's outcome, so the task page can show it. */
      const runId = state.run.id;
      const outcome = state.run.status === 'completed'
        ? await withTenant(env, id.businessId, async (tx) => {
          const [row] = await tx<{ outcome: string | null }[]>`
            select outcome from work_record where run_id = ${runId} order by occurred_at desc limit 1`;
          return row?.outcome ?? null;
        })
        : null;
      return json({
        ok: true,
        runId,
        status: state.run.status,
        pending: !terminalRun(state.run.status),
        ...(outcome ? { text: outcome } : {}),
      }, {}, privateHeaders);
    }
    if (state.run.status === 'completed') {
      const metadata = askMetadata(state.task);
      const completedRunId = state.run.id;
      const { steps, artifacts, ...verdict } = await withTenant(env, id.businessId, async (tx) => {
        const assessment = await taskAssessmentForRun(tx, id.businessId, completedRunId);
        const [row] = await tx<{ kind: string; status: string }[]>`
          select kind, status from work_record where run_id = ${completedRunId} order by occurred_at desc limit 1`;
        return { kind: assessment?.kind ?? row?.kind ?? 'conversation',
          taskStatus: assessment?.status ?? (row?.kind === 'work' ? row.status : undefined),
          steps: await runSteps(tx, id.businessId, completedRunId),
          artifacts: await artifactsForRun(tx, id.businessId, completedRunId) };
      });
      return json({
        ok: true,
        runId: state.run.id,
        status: 'completed',
        pending: false,
        text: answerText(state.task.result),
        sessionId: state.sessionId,
        usedKeys: metadata.usedKeys,
        grounded: metadata.grounded,
        ...verdict,
        ...(steps.length ? { steps } : {}),
        ...(artifacts.length ? { artifacts } : {}),
      }, {}, privateHeaders);
    }
    if (state.run.status === 'failed' || state.run.status === 'cancelled') {
      /* Only a notice this codebase wrote (the credit cap, the provider's
         own quota, an outage, a misconfiguration) crosses from the work
         record to the browser; anything else stays the generic line so raw
         provider text can never reach a page. */
      const failedRunId = state.run.id;
      const failedStatus = state.run.status;
      const { notice, steps, artifacts } = await withTenant(env, id.businessId, async (tx) => {
        const [row] = failedStatus === 'failed'
          ? await tx<{ outcome: string | null }[]>`
            select outcome from work_record where run_id = ${failedRunId} order by occurred_at desc limit 1`
          : [];
        return {
          notice: isFailureNotice(row?.outcome) ? row!.outcome as string : null,
          /* How far it got is still worth showing next to the notice. */
          steps: await runSteps(tx, id.businessId, failedRunId),
          artifacts: await artifactsForRun(tx, id.businessId, failedRunId),
        };
      });
      return json({
        ok: true,
        runId: state.run.id,
        status: state.run.status,
        pending: false,
        err: state.run.status === 'cancelled'
          ? 'Jentera stopped that answer.'
          : notice ?? 'Jentera could not answer that just now. Please try again.',
        ...(steps.length ? { steps } : {}),
        ...(artifacts.length ? { artifacts } : {}),
      }, {}, privateHeaders);
    }
    return json({
      ok: true,
      runId: state.run.id,
      status: state.run.status,
      pending: true,
      ...(runtimeApprovalFromTask(state.task) ? { approvalId: runtimeApprovalFromTask(state.task)!.id } : {}),
    }, {}, privateHeaders);
  }

  const events = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})\/events$/i);
  if (events && request.method === 'GET') {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ ok: false, err: 'websocket required' }, { status: 426 }, cors);
    }
    const origin = request.headers.get('Origin');
    if (!origin || cors['Access-Control-Allow-Origin'] !== origin) {
      /* WebSocket handshakes are not protected by browser CORS enforcement. */
      return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    }
    if (!env.RUN_STREAMS) {
      return json({ ok: false, err: 'realtime updates unavailable' }, { status: 503 }, cors);
    }
    const run = await withTenant(env, id.businessId, (tx) => getRun(tx, id.businessId, events[1]));
    if (!run || run.runtime !== 'hermes-sprite') {
      return json({ ok: false, err: 'run not found' }, { status: 404 }, cors);
    }
    if (terminalRun(run.status)) {
      const type = run.status === 'completed' ? 'completed'
        : run.status === 'cancelled' ? 'cancelled' : 'failed';
      await publishRunProgressSafely(env, id.businessId, run.id, type);
    }
    const streamId = env.RUN_STREAMS.idFromName(`${id.businessId}:${run.id}`);
    return env.RUN_STREAMS.get(streamId).fetch('https://run-stream.internal/subscribe', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        'X-Jentera-Business': id.businessId,
        'X-Jentera-Run': run.id,
        'X-Jentera-User': id.userId,
      },
    });
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
  sessionId?: string,
  requestedMode?: ResponseMode,
  ctx?: BackgroundContext,
  inline?: InlineSliceOptions,
): Promise<Response> {
  if (!env.RUNTIME_QUEUE || !env.AISAR_MODEL_NAME?.trim()) {
    return json({ ok: false, err: 'Jentera agent execution is unavailable' }, { status: 503 }, cors);
  }
  const runtime = await withTenant(env, businessId, (tx) => getRuntime(tx, businessId));
  if (!runtimeReady(runtime)) {
    return json({
      ok: false,
      err: 'Jentera is preparing your agent. Please try again shortly.',
    }, { status: 503 }, cors);
  }

  /* Same retrieval and the same agent prompt as a Telegram message, so a
     question gets one answer regardless of where the owner typed it. */
  const { facts, work, specialists } = await withTenant(env, businessId, async (tx) => {
    const context = await retrieveHermesContext(tx, question);
    return { ...context, specialists: await listSpecialists(tx, { enabledOnly: true }) };
  });
  const specialist = specialistProfileForRequest(question, specialists);
  const prepared = prepareHermesAgent(question, facts, work, new Date(), specialist);
  /* Quick by default, as on Telegram; the toggle or a typed /deep opts in
     to the research loop. Chat was hard-wired to deep until 2026-09-10 and
     every web message paid for it. */
  const responseMode = requestedMode ?? responseModeFor(question);
  const model = modelForResponseMode(env, responseMode, businessId);
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
      triggerRef: { question, requestId, sessionId },
      requestedBy: userId,
      runtime: 'hermes-sprite',
      model,
    });
    await append(tx, businessId, run.id, 'fact.retrieved', {
      keys: prepared.usedKeys,
    });
    const task = await enqueueRuntimeTask(tx, businessId, {
      kind: 'run',
      runId: run.id,
      dedupeKey,
      payload: {
        input: boundedAgentInput(prepared.input),
        instructions: prepared.instructions,
        ...(specialist ? { profile: specialist.profile } : {}),
        sessionId: sessionId ?? run.id,
        objective: question,
        function: 'ask',
        channel: 'app',
        factKeys: prepared.usedKeys,
        grounded: prepared.grounded,
        responseMode,
        model,
        requestedAtMs: Date.now(),
      },
    });
    return { runId: run.id, task };
  });

  /* Sending after commit avoids a message racing an invisible row. If
     delivery fails, the browser can repeat the same requestId: it finds
     this row and safely sends another wake-up signal.

     The intake is placed next to the database; the queue consumer is not,
     and every tenant transaction cost it 1–2 s — a "yob" waited 12–16 s
     before Hermes was even asked (Workers Logs, 2026-09-10). An HTTP
     invocation has no wall-time limit, so the first slice — lease,
     dispatch, live relay — runs here under waitUntil, and the queue only
     gets a delayed wake as the safety net. Without a context the queue
     does all of it, as before. */
  if (ctx) {
    ctx.waitUntil(runInlineSlice(
      env, { version: 1, businessId, taskId: created.task.id }, inline,
    ));
  }
  try {
    await signalRuntimeTask(env, businessId, created.task.id, {
      delaySeconds: ctx ? INLINE_SAFETY_NET_SECONDS : 0,
    });
  } catch {
    /* Queue errors are intentionally not interpolated. Provider/library
       exceptions are not a safe logging contract for credentials. */
    console.error('[durable-ask] queue signal failed');
    /* The inline slice is already running; only its safety net is missing,
       and the recovery sweep re-arms a lease whose owner died. */
    if (!ctx) {
      return json({
        ok: false,
        err: 'Jentera could not queue that answer. Please try again.',
      }, { status: 503 }, cors);
    }
  }
  await publishRunProgressSafely(env, businessId, created.runId, 'queued');
  return json({
    ok: true,
    pending: true,
    status: created.task.status,
    runId: created.runId,
  }, { status: 202 }, cors);
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
  return 'Jentera completed the work but returned no readable answer.';
}

function terminalRun(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}
