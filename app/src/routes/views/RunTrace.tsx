/* ============================================================
   The technical trace of one run.

   Advanced mode's reason for existing. Everything else in the product
   tells the owner what happened in their own terms; this shows the
   record the system actually kept — every event, in order, with its
   payload.

   It is deliberately not prettified into a story. The value of a trace
   is that it is the same thing an engineer would read when something
   went wrong, so a summary of it would defeat the point.
   ============================================================ */

import { useEffect, useState } from 'react';
import { useRepository } from '@/lib/repo';
import type { TraceEvent } from '@/lib/repo';

/** The vocabulary, in the owner's words. Unknown types render raw
    rather than being hidden — an event nobody labelled is exactly the
    one worth noticing. */
const PLAIN: Record<string, string> = {
  'work.requested': 'Work started',
  'work.started': 'Began reading',
  'fact.retrieved': 'Looked up what it knows',
  'action.proposed': 'Decided what to do',
  'approval.requested': 'Asked you',
  'owner.edited': 'You changed the wording',
  'approval.granted': 'You approved',
  'approval.rejected': 'You declined',
  'action.executed': 'Did it',
  'work.completed': 'Finished',
  'work.failed': 'Failed',
  'outcome.observed': 'Result came back',
};

function summarise(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload !== 'object') return String(payload);
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function RunTrace({ runId }: { runId: string }) {
  const repo = useRepository();
  const [events, setEvents] = useState<TraceEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void repo.runTrace(runId).then(
      (e) => live && setEvents(e),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [repo, runId]);

  if (error) return <p className="text-[12px] text-text-secondary">{error}</p>;
  if (!events) return <p className="text-[12px] text-text-muted">Loading the trace…</p>;
  if (events.length === 0) {
    return <p className="text-[12px] text-text-muted">No trace recorded for this run.</p>;
  }

  return (
    <ol className="flex flex-col gap-2 border-l border-rail pl-3">
      {events.map((e) => {
        const detail = summarise(e.payload);
        return (
          <li key={e.seq} className="flex flex-col gap-0.5">
            <span className="text-[12px]">
              <span className="text-text-muted">{e.seq}.</span>{' '}
              {PLAIN[e.type] ?? e.type}{' '}
              {/* The raw name alongside the plain one. Someone in
                  advanced mode is likely to be matching this against a
                  log or the schema, and a translated-only view would
                  make that impossible. */}
              <span className="font-mono text-[11px] text-text-muted">{e.type}</span>
            </span>
            {detail && (
              <span className="font-mono text-[11px] leading-snug text-text-secondary">
                {detail}
              </span>
            )}
            <span className="text-[10px] text-text-muted">
              {new Date(e.createdAt).toLocaleTimeString()}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
