import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';

const ANSWER = {
  ok: true,
  runId: '11111111-1111-4111-8111-111111111111',
  text: 'A grounded answer.',
  usedKeys: ['business.name'],
  grounded: true,
};

describe('RemoteRepository durable Ask AISAR bridge', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('preserves synchronous answers for businesses outside the canary', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(ANSWER));
    vi.stubGlobal('fetch', fetch);

    await expect(new RemoteRepository().ask('What happened?')).resolves.toEqual(ANSWER);
    expect(fetch).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(sent.question).toBe('What happened?');
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent).not.toHaveProperty('businessId');
  });

  it('polls a durable run and returns its completed answer', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, pending: true, status: 'queued', runId: ANSWER.runId }, 202))
      .mockResolvedValueOnce(response({ ...ANSWER, pending: false, status: 'completed' }));
    vi.stubGlobal('fetch', fetch);

    await expect(new RemoteRepository().ask('What happened?')).resolves.toMatchObject(ANSWER);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toBe(`/api/runs/${ANSWER.runId}`);
  });

  it('surfaces a safe terminal failure without waiting again', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, pending: true, status: 'queued', runId: ANSWER.runId }, 202))
      .mockResolvedValueOnce(response({
        ok: true,
        pending: false,
        status: 'failed',
        runId: ANSWER.runId,
        err: 'AISAR could not answer that just now. Please try again.',
      }));
    vi.stubGlobal('fetch', fetch);

    await expect(new RemoteRepository().ask('What happened?')).rejects.toThrow(
      'AISAR could not answer that just now. Please try again.',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reuses one idempotency key when the queue signal needs a retry', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({
        ok: false,
        err: 'AISAR could not queue that answer. Please try again.',
      }, 503))
      .mockResolvedValueOnce(response({ ok: true, pending: true, status: 'queued', runId: ANSWER.runId }, 202))
      .mockResolvedValueOnce(response({ ...ANSWER, pending: false, status: 'completed' }));
    vi.stubGlobal('fetch', fetch);

    await expect(new RemoteRepository().ask('What happened?')).resolves.toMatchObject(ANSWER);
    const first = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(second.requestId).toBe(first.requestId);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
