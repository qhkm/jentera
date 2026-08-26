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
import { MODEL, extractFacts, fetchPage, urlProblem } from '../ingest';

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

    const run = await withTenant(env, id.businessId, (tx) =>
      startRun(tx, id.businessId, {
        kind: 'ingest',
        triggerShape: 'owner.ingest.url',
        triggerRef: { url: target },
        requestedBy: id.userId,
        runtime: 'worker-inline',
        model: MODEL,
      }),
    );

    try {
      const page = await fetchPage(target);
      await withTenant(env, id.businessId, (tx) =>
        append(tx, id.businessId, run.id, 'work.started', {
          url: target,
          title: page.title,
          chars: page.text.length,
        }),
      );

      const candidates = await extractFacts(env, page.text, page.title);

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
          inputsUsed: { url: target, chars: page.text.length },
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
