import type { Env } from '../env';
import { LIVE_DETAIL_MAX, LIVE_TEXT_MAX } from '../run-stream-events';
import type { StatusKind } from '../run-stream-events';
import { publishRunProgress, publishRunProgressSafely } from './progress';

/** How long answer text may sit before it is sent, and how much may
    accumulate first. Four sends a second reads as streaming in a browser;
    one Durable Object call per token would not. */
const DELTA_FLUSH_MS = 250;
const DELTA_FLUSH_CHARS = 400;

export interface WebProgress {
  /** A status line: a dispatch stage (the default label), one of the
      agent's own `@step` lines, or a tool call. */
  status(detail: string, kind?: StatusKind): Promise<void>;
  thinking(detail: string): Promise<void>;
  delta(text: string): void;
  flush(): Promise<void>;
  /** Release an answer the stream gate withheld, so the chat shows it without
      waiting for the checks that follow it. Resolves true when the stream
      accepted every piece — which says it was published, not that anyone was
      watching; only the client knows that. */
  reveal(text: string): Promise<boolean>;
}

/**
 * The web chat's view of a run while it is working: the same status lines
 * and reasoning slice the Telegram bubble shows, plus the answer as it
 * streams. Publishes are serialised so text never arrives out of order,
 * and every call is best effort: the durable answer does not depend on it.
 */
export function createWebProgress(env: Env, businessId: string, runId: string): WebProgress {
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStatus = '';
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    chain = chain.then(work, work);
    return chain;
  };
  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!buffer) return chain;
    const text = buffer;
    buffer = '';
    return enqueue(() => publishRunProgressSafely(env, businessId, runId, 'delta', { text }));
  };
  /* One push would be cut at LIVE_TEXT_MAX by the publish endpoint, so a
     withheld answer goes out in publish-sized pieces. Unlike every other
     call here this one reports failure: a measurement built on the safe
     publisher would count an answer nobody was sent. */
  const reveal = async (text: string): Promise<boolean> => {
    if (!text) return false;
    await flush();
    let published = true;
    for (let at = 0; at < text.length; at += LIVE_TEXT_MAX) {
      const piece = text.slice(at, at + LIVE_TEXT_MAX);
      await enqueue(async () => {
        try { await publishRunProgress(env, businessId, runId, 'delta', { text: piece }); }
        catch { published = false; }
      });
    }
    return published;
  };
  return {
    reveal,
    status(detail, kind = 'stage') {
      const line = detail.trim().slice(0, LIVE_DETAIL_MAX);
      if (!line || line === lastStatus) return chain;
      lastStatus = line;
      return enqueue(() => publishRunProgressSafely(env, businessId, runId, 'status', { detail: line, kind }));
    },
    thinking(detail) {
      const line = detail.trim().slice(0, LIVE_DETAIL_MAX);
      if (!line) return chain;
      return enqueue(() => publishRunProgressSafely(env, businessId, runId, 'thinking', { detail: line }));
    },
    delta(text) {
      if (!text) return;
      buffer += text;
      if (buffer.length >= DELTA_FLUSH_CHARS || buffer.length >= LIVE_TEXT_MAX) {
        void flush();
      } else if (!timer) {
        timer = setTimeout(() => { void flush(); }, DELTA_FLUSH_MS);
      }
    },
    flush,
  };
}
