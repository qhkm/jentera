import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

// One viewer per runtime. Frames are never queued or persisted.
const viewers = new WeakSet();
export async function serveBrowserPreview(res, browser, isActive, { duration = 45000, interval = 1000 } = {}) {
  if (viewers.has(browser)) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'browser_busy' }));
    return;
  }
  viewers.add(browser);
  const stop = new AbortController();
  const close = () => stop.abort();
  res.on('close', close);
  const deadline = setTimeout(close, duration);
  try {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'private, no-store' });
    res.flushHeaders();
    while (!stop.signal.aborted) {
      let frame = { previewStatus: 'inactive' };
      if (await isActive()) {
        frame = await browser.preview({ streaming: true });
        if (!await isActive()) frame = { previewStatus: 'inactive' };
      }
      if (stop.signal.aborted) break;
      // Backpressure: only one frame in flight; never accumulate screenshots.
      if (!res.write(`${JSON.stringify(frame)}\n`)) await once(res, 'drain', { signal: stop.signal });
      if (frame.previewStatus === 'inactive') break;
      await delay(interval, undefined, { signal: stop.signal });
    }
  } catch {
    // No page content or exception strings may escape this boundary.
  } finally {
    clearTimeout(deadline);
    res.off('close', close);
    viewers.delete(browser);
    res.end();
  }
}
