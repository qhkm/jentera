import { describe, expect, it, vi } from 'vitest';
import { publishRunProgress, publishRunProgressSafely } from '../src/runtime/progress';
import { testEnv } from './harness';

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

describe('run progress binding', () => {
  it('addresses one private Durable Object per tenant run and sends only bounded state', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
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
