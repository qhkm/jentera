import { describe, expect, it, vi } from 'vitest';
import { publishRunProgress, publishRunProgressSafely } from '../src/runtime/progress';
import { fetchFake, testEnv } from './harness';
import { liveEvent, LIVE_DETAIL_MAX, LIVE_TEXT_MAX } from '../src/run-stream-events';

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

describe('run progress binding', () => {
  it('addresses one private Durable Object per tenant run and sends only bounded state', async () => {
    const fetch = fetchFake(async () => Response.json({ ok: true }));
    const idFromName = vi.fn(() => ({ toString: () => 'stream-id' }));
    const env = testEnv({
      RUN_STREAMS: {
        idFromName,
        get: () => ({ fetch }),
      },
    });

    await publishRunProgress(env, BUSINESS, RUN, 'working');

    expect(idFromName).toHaveBeenCalledWith(`${BUSINESS}:${RUN}`);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://run-stream.internal/publish');
    expect(JSON.parse(String(init?.body))).toEqual({
      businessId: BUSINESS,
      runId: RUN,
      type: 'working',
    });
  });

  it('never lets realtime failure fail authoritative runtime work', async () => {
    const env = testEnv({
      RUN_STREAMS: {
        idFromName: () => ({ toString: () => 'stream-id' }),
        get: () => ({ fetch: async () => new Response('no', { status: 503 }) }),
      },
    });

    await expect(publishRunProgress(env, BUSINESS, RUN, 'working')).rejects.toThrow(/503/);
    await expect(publishRunProgressSafely(env, BUSINESS, RUN, 'working')).resolves.toBeUndefined();
  });

  it('is a no-op where the binding is intentionally absent', async () => {
    await expect(publishRunProgress(testEnv(), BUSINESS, RUN, 'queued')).resolves.toBeUndefined();
  });
});

describe('live progress for the web chat', () => {
  it('carries bounded detail and text alongside the lifecycle type', async () => {
    const fetch = fetchFake(async () => Response.json({ ok: true }));
    const env = testEnv({
      RUN_STREAMS: { idFromName: () => ({ toString: () => 'stream-id' }), get: () => ({ fetch }) },
    });
    await publishRunProgress(env, BUSINESS, RUN, 'delta', { text: 'We are ' });
    await publishRunProgress(env, BUSINESS, RUN, 'status', { detail: 'Searching the web…' });
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([
      { businessId: BUSINESS, runId: RUN, type: 'delta', text: 'We are ' },
      { businessId: BUSINESS, runId: RUN, type: 'status', detail: 'Searching the web…' },
    ]);
  });

  it('parses a live event only when its type and payload are the reviewed shape', () => {
    expect(liveEvent({ type: 'status', detail: '  Reading 2 pages…  ' })).toMatchObject({
      version: 1, seq: 0, type: 'status', detail: 'Reading 2 pages…',
    });
    expect(liveEvent({ type: 'thinking', detail: 'x'.repeat(LIVE_DETAIL_MAX + 50) })?.detail)
      .toHaveLength(LIVE_DETAIL_MAX);
    expect(liveEvent({ type: 'delta', text: 'y'.repeat(LIVE_TEXT_MAX + 5) })?.text)
      .toHaveLength(LIVE_TEXT_MAX);
    expect(liveEvent({ type: 'delta', text: '' })).toBeNull();
    expect(liveEvent({ type: 'status' })).toBeNull();
    expect(liveEvent({ type: 'working', detail: 'not live' })).toBeNull();
    expect(liveEvent({ type: 'delta', detail: 'wrong field' })).toBeNull();
  });
});
