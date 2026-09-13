export type ModelResponseEnd = 'completed' | 'error' | 'cancelled';

/** One-minute inactivity limit across headers AND body; five-minute absolute
 * ceiling. Real bytes refresh inactivity, never the absolute limit.
 * Cancelling downstream also closes upstream. Diagnostics are best-effort.
 */
export async function fetchModelResponse(
  fetcher: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  onEnd?: (end: ModelResponseEnd) => void,
): Promise<Response> {
  const abort = new AbortController();
  const signal = init.signal ? AbortSignal.any([abort.signal, init.signal]) : abort.signal;
  let ended = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  const timeout = () => abort.abort(new DOMException('Model response timed out', 'TimeoutError'));
  let idleTimer = setTimeout(timeout, 60_000);
  const totalTimer = setTimeout(timeout, 300_000);
  const finish = (end: ModelResponseEnd) => {
    if (ended) return;
    ended = true;
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    signal.removeEventListener('abort', onAbort);
    try { onEnd?.(end); } catch { /* Diagnostics cannot fail a reply. */ }
  };
  const onAbort = () => {
    if (ended) return;
    finish(init.signal?.aborted ? 'cancelled' : 'error');
    output?.error(signal.reason);
    void reader?.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    const response = await fetcher(input, { ...init, signal });
    if (signal.aborted) throw signal.reason;
    if (!response.body) { finish('completed'); return response; }
    reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { output = controller; },
      async pull(controller) {
        try {
          const chunk = await reader!.read();
          if (ended) return;
          if (chunk.done) { finish('completed'); controller.close(); reader!.releaseLock(); return; }
          if (chunk.value.byteLength) {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(timeout, 60_000);
          }
          controller.enqueue(chunk.value);
        } catch (error) {
          if (!ended) { finish('error'); controller.error(error); }
          abort.abort(error);
          void reader?.cancel(error).catch(() => {});
        }
      },
      cancel(reason) {
        finish('cancelled');
        abort.abort(reason);
        // An upstream may never acknowledge cancel; don't wait for it.
        void reader?.cancel(reason).catch(() => {});
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    finish(init.signal?.aborted ? 'cancelled' : 'error');
    abort.abort(error);
    throw error;
  }
}
