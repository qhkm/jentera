import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';

const ANSWER = {
  ok: true,
  runId: '11111111-1111-4111-8111-111111111111',
  text: 'A grounded answer.',
  usedKeys: ['business.name'],
  grounded: true,
};

describe('RemoteRepository durable Ask Jentera bridge', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves synchronous answers for businesses outside the canary', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(ANSWER));
    vi.stubGlobal('fetch', fetch);

    const created = vi.fn();
    await expect(new RemoteRepository().ask('What happened?', { sessionId: 'chat-1', onRunCreated: created })).resolves.toEqual(ANSWER);
    expect(created).toHaveBeenCalledExactlyOnceWith(ANSWER.runId);
    expect(fetch).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(sent.question).toBe('What happened?');
    expect(sent.mode).toBe('work');
    expect(sent.sessionId).toBe('chat-1');
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

  it('recovers status reads after network and server failures without posting the job again', async () => {
    vi.useFakeTimers(); vi.stubGlobal('WebSocket', undefined);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, pending: true, status: 'queued', runId: ANSWER.runId }, 202))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response({ err: 'Unavailable' }, 503))
      .mockResolvedValueOnce(response({ ...ANSWER, pending: false, status: 'completed' }));
    vi.stubGlobal('fetch', fetch);
    const progress = vi.fn();
    const result = new RemoteRepository().ask('Do the job', { onProgress: progress });
    const check = expect(result).resolves.toMatchObject(ANSWER);
    await vi.advanceTimersByTimeAsync(10000); await check;
    expect(fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
    expect(fetch.mock.calls.slice(1).every(call => String(call[0]) === `/api/runs/${ANSWER.runId}`)).toBe(true);
    expect(progress).toHaveBeenCalledWith({ type: 'reconnecting' });
    expect(progress).toHaveBeenCalledWith({ type: 'reconnecting', detail: 'recovered' });
  });

  it.each([401, 403, 404])('does not retry access failures (%s)', async status => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, pending: true, runId: ANSWER.runId }, 202))
      .mockResolvedValueOnce(response({ err: 'Access denied' }, status));
    vi.stubGlobal('fetch', fetch);
    await expect(new RemoteRepository().ask('Do the job')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stops recovering at the deadline instead of polling indefinitely', async () => {
    vi.useFakeTimers(); vi.stubGlobal('WebSocket', undefined);
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetch);
    const result = new RemoteRepository().resumeAsk(ANSWER.runId);
    const check = expect(result).rejects.toThrow('taking longer than expected');
    await vi.advanceTimersByTimeAsync(17 * 60 * 1000); await check;
    const count = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetch).toHaveBeenCalledTimes(count);
    expect(fetch.mock.calls.every(call => call[1]?.method !== 'POST')).toBe(true);
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

    const created = vi.fn();
    await expect(new RemoteRepository().ask('What happened?', { onRunCreated: created })).rejects.toThrow(
      'Jentera could not answer that just now. Please try again.',
    );
    expect(created).toHaveBeenCalledExactlyOnceWith(ANSWER.runId);
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
    const created = vi.fn();

    const answer = new RemoteRepository().ask('What happened?', {
      mode: 'work',
      onRunCreated: created,
      onProgress: (event) => progress.push(event.type),
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(created).toHaveBeenCalledExactlyOnceWith(ANSWER.runId);
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

  it('recovers after the socket closes and the first fallback read fails', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('network changed'))
      .mockResolvedValueOnce(response({ ...ANSWER, pending: false, status: 'completed' }));
    vi.stubGlobal('fetch', fetch);
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor(url: string) { super(url); sockets.push(this); }
    });
    const result = new RemoteRepository().resumeAsk(ANSWER.runId);
    const check = expect(result).resolves.toMatchObject(ANSWER);
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(5000); await check;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(call => call[1]?.method !== 'POST')).toBe(true);
  });

  it('reattaches to a run by its id and returns the durable answer', async () => {
    /* After a reload the page has a run id and nothing else; the same
       socket and durable poll finish it as if the tab never went away. */
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...ANSWER, pending: false, status: 'completed' }));
    vi.stubGlobal('fetch', fetch);
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    const progress: string[] = [];

    const answer = new RemoteRepository().resumeAsk(ANSWER.runId, {
      onProgress: (event) => progress.push(event.type),
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(sockets[0].url).toContain(`/api/runs/${ANSWER.runId}/events`);
    sockets[0].message({ version: 1, seq: 2, type: 'working' });
    sockets[0].message({ version: 1, seq: 3, type: 'completed' });

    await expect(answer).resolves.toMatchObject(ANSWER);
    expect(progress).toEqual(['working']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe(`/api/runs/${ANSWER.runId}`);

    await expect(new RemoteRepository().resumeAsk('not-a-run')).rejects.toThrow('Invalid task link.');
  });

  it('reads one tenant-scoped task and rejects invalid or mismatched links', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...ANSWER, status: 'completed', pending: false }));
    vi.stubGlobal('fetch', fetch);
    const repo = new RemoteRepository();
    await expect(repo.runResult('../activity')).rejects.toThrow('Invalid task link');
    expect(fetch).not.toHaveBeenCalled();
    await expect(repo.runResult(ANSWER.runId)).resolves.toMatchObject({ runId: ANSWER.runId, text: ANSWER.text });
    expect(String(fetch.mock.calls[0][0])).toBe(`/api/runs/${ANSWER.runId}`);
    expect(fetch.mock.calls[0][1].credentials).toBe('include');
    fetch.mockResolvedValueOnce(response({ ...ANSWER, runId: 'another-task', status: 'completed', pending: false }));
    await expect(repo.runResult(ANSWER.runId)).rejects.toThrow('Could not read');
    fetch.mockResolvedValueOnce(response({ ok: false, err: 'run not found' }, 404));
    await expect(repo.runResult(ANSWER.runId)).rejects.toThrow('run not found');
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
