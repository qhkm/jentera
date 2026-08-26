/* ============================================================
   Run endpoints.

   Ingestion runs inline rather than through a queue. That is a
   deliberate limit, not an oversight: fetch plus one model call fits
   inside a request, and a queue would add a delivery guarantee, a
   consumer, and a polling UI before there is anything to poll for.
   When a run type appears that cannot finish inside a request — a
   multi-page crawl, a scheduled sweep — the `run` row already exists
   to hand to a consumer, which is why the spine went in first.
   ============================================================ */

import type { Env } from './../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { append, finishRun, homeCounters, recentWork, recordWork, runTrace, startRun } from '../runs';
import { recordFact } from '../facts';
import { urlProblem } from '../ingest';
import { runtimeFor } from '../runtime';
import { retrieve } from '../ask';

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

      return json({ ok: true, runId: run.id, facts: written.length, keys: written }, {}, cors);
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
    const body = (await request.json().catch(() => ({}))) as { question?: string };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return json({ ok: false, err: 'ask me something' }, { status: 400 }, cors);
    if (question.length > 1000) {
      return json({ ok: false, err: 'that question is too long' }, { status: 400 }, cors);
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

  const trace = url.pathname.match(/^\/api\/runs\/([0-9a-f-]{36})\/trace$/i);
  if (trace && request.method === 'GET') {
    const events = await withTenant(env, id.businessId, (tx) => runTrace(tx, trace[1]));
    return json({ ok: true, events }, {}, cors);
  }

  return null;
}
