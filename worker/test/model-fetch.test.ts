import { afterEach, expect, it, vi } from 'vitest';
import { fetchModelResponse } from '../src/model-fetch';

afterEach(() => vi.useRealTimers());

it('aborts a connection that never responds and does not retry it in the proxy', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
    signal = init?.signal;
    signal?.addEventListener('abort', () => reject(signal?.reason));
  }));
  const result = fetchModelResponse(fetcher, 'https://example.test', {});
  const assertion = expect(result).rejects.toThrow('Model response timed out');
  await vi.advanceTimersByTimeAsync(60_000);
  await assertion;
  expect(signal?.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('refreshes inactivity for a healthy streaming answer and cleans up after completion', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher: typeof fetch = async (_input, init) => {
    signal = init?.signal;
    return new Response(new ReadableStream({ start(c) { source = c; } }));
  };
  const response = await fetchModelResponse(fetcher, 'https://example.test', {});
  const text = response.text();
  await vi.advanceTimersByTimeAsync(40_000);
  source.enqueue(new TextEncoder().encode('an'));
  await vi.advanceTimersByTimeAsync(40_000);
  source.enqueue(new TextEncoder().encode('swer'));
  expect(signal?.aborted).toBe(false);
  source.close();
  expect(await text).toBe('answer');
  expect(vi.getTimerCount()).toBe(0);
});

it('aborts and reports a body that stalls after successful headers', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const end = vi.fn();
  const response = await fetchModelResponse(async () => new Response(new ReadableStream({ cancel })), 'https://example.test', {}, end);
  const reading = expect(response.text()).rejects.toThrow('Model response timed out');
  await vi.advanceTimersByTimeAsync(60_000);
  await reading;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledExactlyOnceWith('error');
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels upstream even when it never acknowledges cancellation', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const end = vi.fn();
  const response = await fetchModelResponse(async () => new Response(new ReadableStream({ cancel })), 'https://example.test', {}, end);
  await response.body!.cancel();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledExactlyOnceWith('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

it('enforces the absolute deadline even when data keeps arriving', async () => {
  vi.useFakeTimers();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const response = await fetchModelResponse(async () => new Response(new ReadableStream({ start(c) { source = c; } })), 'https://example.test', {});
  const reading = expect(response.text()).rejects.toThrow('Model response timed out');
  for (let i = 0; i < 7; i++) {
    await vi.advanceTimersByTimeAsync(40_000);
    source.enqueue(new Uint8Array([65]));
  }
  await vi.advanceTimersByTimeAsync(20_000);
  await reading;
  expect(vi.getTimerCount()).toBe(0);
});

it('does not dispatch an already cancelled request', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  abort.abort(new Error('caller left'));
  const fetcher = vi.fn<typeof fetch>();
  const end = vi.fn();
  await expect(fetchModelResponse(fetcher, 'https://example.test', { signal: abort.signal }, end)).rejects.toThrow('caller left');
  expect(fetcher).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledExactlyOnceWith('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

it('aborts a pending body when the caller disconnects', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const cancel = vi.fn();
  const end = vi.fn();
  const response = await fetchModelResponse(async () => new Response(new ReadableStream({ cancel })), 'https://example.test', { signal: abort.signal }, end);
  const reading = expect(response.text()).rejects.toThrow('caller left');
  abort.abort(new Error('caller left'));
  await reading;
  expect(end).toHaveBeenCalledExactlyOnceWith('cancelled');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
