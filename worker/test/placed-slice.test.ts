import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleQueueMessagePlaced, PLACED_SLICE_PATH, queueMessageResult } from '../src/runtime/placed-slice';
import { testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const message = { version: 1 as const, businessId: A, taskId: T };

beforeEach(async () => {
  await truncateAll();
});

describe('the placed slice', () => {
  /* Queue consumers run in the US (LAX, SJC, IAD measured 2026-09-10) and
     pay 1–2 s per tenant transaction; a service binding to this Worker runs
     its fetch handler in Singapore, 16–28 ms from Neon. The consumer hands
     every message across and only runs it locally when that fails. */
  it('hands the message to the placed handler and applies its result', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const env = testEnv({
      AISAR_SUPPORT_KEY: 'support-secret',
      SELF: {
        fetch: async (url: string, init: RequestInit) => {
          calls.push({ url, init });
          return Response.json({ action: 'requeue', delaySeconds: 2, reason: 'bounded observation slice completed' });
        },
      },
    });
    await expect(handleQueueMessagePlaced(env, message)).resolves.toEqual({
      action: 'requeue', delaySeconds: 2, reason: 'bounded observation slice completed', placed: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`http://localhost:8787${PLACED_SLICE_PATH}`);
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer support-secret');
    expect(JSON.parse(String(calls[0].init.body))).toEqual(message);
  });

  it('runs the message here when the placed handler fails or answers nonsense', async () => {
    const failing = testEnv({
      AISAR_SUPPORT_KEY: 'support-secret',
      SELF: { fetch: async () => new Response('error code: 522', { status: 502 }) },
    });
    /* An unknown task is acked as missing by the local consumer. */
    await expect(handleQueueMessagePlaced(failing, message))
      .resolves.toEqual({ action: 'ack', reason: 'missing', placed: false });

    const nonsense = testEnv({
      AISAR_SUPPORT_KEY: 'support-secret',
      SELF: { fetch: async () => Response.json({ action: 'requeue', reason: 'no delay' }) },
    });
    await expect(handleQueueMessagePlaced(nonsense, message))
      .resolves.toEqual({ action: 'ack', reason: 'missing', placed: false });
  });

  it('runs the message here without a binding or a key', async () => {
    const fetchSpy = vi.fn();
    const env = testEnv({ SELF: { fetch: fetchSpy } });
    await expect(handleQueueMessagePlaced(env, message))
      .resolves.toEqual({ action: 'ack', reason: 'missing', placed: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts only the reviewed result shape', () => {
    expect(queueMessageResult({ action: 'ack', reason: 'completed' })).toEqual({ action: 'ack', reason: 'completed' });
    expect(queueMessageResult({ action: 'ack', reason: 'whatever' })).toBeNull();
    expect(queueMessageResult({ action: 'retry', delaySeconds: 99_999, reason: 'x' }))
      .toEqual({ action: 'retry', delaySeconds: 3_600, reason: 'x' });
    expect(queueMessageResult({
      action: 'requeue', delaySeconds: 5, reason: 'admitted', nextMessage: { version: 1, businessId: A, taskId: T },
    })).toEqual({ action: 'requeue', delaySeconds: 5, reason: 'admitted', nextMessage: message });
    expect(queueMessageResult({
      action: 'requeue', delaySeconds: 5, reason: 'admitted', nextMessage: { version: 1, businessId: 'nope', taskId: T },
    })).toBeNull();
    expect(queueMessageResult('ack')).toBeNull();
  });
});
