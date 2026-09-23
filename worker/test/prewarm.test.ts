import { expect, it, vi } from 'vitest';
import { PREWARM_TIMEOUT_MS, prewarmSprite } from '../src/runtime/prewarm';

/* Prewarm turns a cold wake into a warm one before the owner's message
   arrives. Measured across the fleet on 23 September: every failure was at
   exactly the old 8000 ms budget — not one was a refusal or a connection
   error — while the slowest success took 6927 ms, 87% of that budget. The
   timeout sat inside the cold-wake distribution rather than beyond it, so it
   abandoned wakes it had itself started and recorded them as failures. */

const url = 'https://sprite-abc.sprites.app';
const token = 'runtime-token';

it('allows a cold wake to finish, which the old budget did not', () => {
  // A cold wake measured 15-30 s. A budget inside that range cannot tell a
  // slow wake from a broken sprite, which is the bug this fixes.
  expect(PREWARM_TIMEOUT_MS).toBeGreaterThan(15_000);
  // Nothing user-facing waits on this — the route answers 202 and runs the
  // probe in waitUntil — but it must still fit inside that tail.
  expect(PREWARM_TIMEOUT_MS).toBeLessThanOrEqual(28_000);
});

it('reports a warm sprite as ready, with the time it took', async () => {
  const fetchFake = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchFake);
  const result = await prewarmSprite(url, token);
  expect(result.outcome).toBe('prewarm_ready');
  expect(fetchFake).toHaveBeenCalledOnce();
  const [target, init] = fetchFake.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(target)).toBe(`${url}/healthz`);
  expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  vi.unstubAllGlobals();
});

it('separates a sprite that refused from one that never answered', async () => {
  vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }));
  expect((await prewarmSprite(url, token)).outcome).toBe('prewarm_rejected');

  vi.stubGlobal('fetch', async () => { throw new DOMException('aborted', 'TimeoutError'); });
  expect((await prewarmSprite(url, token)).outcome).toBe('prewarm_failed');
  vi.unstubAllGlobals();
});

/* The organization token is never handed to an arbitrary stored URL. */
it('refuses to carry the token anywhere but a sprite over https', async () => {
  const fetchFake = vi.fn();
  vi.stubGlobal('fetch', fetchFake);
  for (const bad of ['http://sprite-abc.sprites.app', 'https://evil.example',
    'https://sprites.app.evil.example', 'not a url']) {
    expect((await prewarmSprite(bad, token)).outcome).toBe('prewarm_skipped');
  }
  expect(fetchFake).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
