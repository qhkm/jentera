import { expect, it } from 'vitest';
import { sanitizePreviewStream } from '../src/routes/browser';

function source(parts: string[]) {
  return new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
}
it('handles split frames and strips private and incidental fields', async () => {
  const capturedAt = Date.now();
  const raw = JSON.stringify({ previewStatus: 'ready', image: 'YWJj', capturedAt, secret: 'no' });
  const result = await new Response(sanitizePreviewStream(source([raw.slice(0, 10), raw.slice(10) + '\n', '{"previewStatus":"private","image":"secret"}\n']))).text();
  expect(result.trim().split('\n').map(line => JSON.parse(line))).toEqual([
    { previewStatus: 'ready', image: 'YWJj', capturedAt }, { previewStatus: 'private' },
  ]);
});
it('rejects oversized, malformed and truncated frame streams', async () => {
  for (const parts of [['x'.repeat(671001)], ['not-json\n'], ['{"previewStatus":']]) {
    await expect(new Response(sanitizePreviewStream(source(parts))).text()).rejects.toThrow();
  }
});
