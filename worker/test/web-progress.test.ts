import { describe, expect, it } from 'vitest';
import { createWebProgress } from '../src/runtime/web-progress';
import { LIVE_TEXT_MAX } from '../src/run-stream-events';
import type { Env } from '../src/env';

/** The publish endpoint cuts each push at LIVE_TEXT_MAX, so an answer released
    in one call would arrive truncated with nothing to say it had been. */
function streamFake() {
  const published: { type: string; text?: string }[] = [];
  const env = {
    RUN_STREAMS: {
      idFromName: () => 'id',
      get: () => ({
        fetch: async (_url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body)) as { type: string; text?: string };
          published.push({ type: body.type, ...(body.text === undefined ? {} : { text: body.text.slice(0, LIVE_TEXT_MAX) }) });
          return new Response('{}');
        },
      }),
    },
  } as unknown as Env;
  return { env, published };
}

describe('releasing an answer the stream gate withheld', () => {
  it('publishes every character of an answer longer than one push', async () => {
    const { env, published } = streamFake();
    const answer = 'x'.repeat(LIVE_TEXT_MAX * 2 + 137);
    await createWebProgress(env, 'b', 'r').reveal(answer);
    expect(published.every(event => event.type === 'delta')).toBe(true);
    expect(published.map(event => event.text ?? '').join('')).toBe(answer);
    expect(published.length).toBe(3);
  });

  it('sends a short answer as one delta and nothing for an empty one', async () => {
    const { env, published } = streamFake();
    const progress = createWebProgress(env, 'b', 'r');
    await progress.reveal('Yes, we are open on Sunday.');
    await progress.reveal('');
    expect(published).toEqual([{ type: 'delta', text: 'Yes, we are open on Sunday.' }]);
  });
});
