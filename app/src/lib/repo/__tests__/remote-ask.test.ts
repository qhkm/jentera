import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';

const ANSWER = {
  ok: true,
  runId: '11111111-1111-4111-8111-111111111111',
  text: 'A grounded answer.',
  usedKeys: ['business.name'],
  grounded: true,
};

describe('RemoteRepository durable Ask Jentera bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves synchronous answers for businesses outside the canary', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(ANSWER));
    vi.stubGlobal('fetch', fetch);

    await expect(new RemoteRepository().ask('What happened?')).resolves.toEqual(ANSWER);
    expect(fetch).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(sent.question).toBe('What happened?');
    expect(sent.mode).toBe('ask');
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
        err: 'Jentera could not answer that just now. Please try again.',
      }));
    vi.stubGlobal('fetch', fetch);

    await expect(new RemoteRepository().ask('What happened?')).rejects.toThrow(
      'Jentera could not answer that just now. Please try again.',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reuses one idempotency key when the queue signal needs a retry', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({
        ok: false,
        err: 'Jentera could not queue that answer. Please try again.',
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

  it('uses WebSocket progress and fetches the durable result after completion', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, pending: true, status: 'queued', runId: ANSWER.runId }, 202))
      .mockResolvedValueOnce(response({ ...ANSWER, pending: false, status: 'completed' }));
    vi.stubGlobal('fetch', fetch);
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    const progress: string[] = [];

    const answer = new RemoteRepository().ask('What happened?', {
      mode: 'work',
      onProgress: (state) => progress.push(state),
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(sent.mode).toBe('work');
    expect(sockets[0].url).toContain(`/api/runs/${ANSWER.runId}/events`);
    expect(sockets[0].url.startsWith('ws:')).toBe(true);
    sockets[0].message({ version: 1, seq: 1, type: 'waking' });
    sockets[0].message({ version: 1, seq: 2, type: 'working' });
    sockets[0].message({ version: 1, seq: 3, type: 'completed' });

    await expect(answer).resolves.toMatchObject(ANSWER);
    expect(progress).toEqual(['waking', 'working']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class FakeWebSocket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {}

  close(): void {}

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
