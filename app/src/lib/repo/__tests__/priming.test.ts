/* ============================================================
   Not asking twice for an answer we already have.

   Startup fetched /api/me to decide whether the session was
   server-backed, and called load() to detect a first sign-in. Both
   responses were thrown away, and the provider and the detail-level
   hook asked for them again a moment later. Four requests on every
   load of the app where two would do.

   The risk in fixing it is staleness — a primed answer that outlives
   startup and gets served to a later reload. So each is consumed
   exactly once, and these tests hold that as tightly as they hold the
   saving.
   ============================================================ */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';
import type { BusinessSnapshot } from '@/lib/repo/types';

const calls: string[] = [];

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith('/api/me')) return respond({ ok: true, detailLevel: 'advanced' });
      return respond({ ok: true, snapshot: {} });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const count = (fragment: string) => calls.filter((c) => c.includes(fragment)).length;

describe('a primed snapshot', () => {
  it('is served without a request', async () => {
    const repo = new RemoteRepository();
    const first = await repo.load();
    expect(count('/api/state')).toBe(1);

    repo.prime({ state: first });
    await repo.load();
    expect(count('/api/state'), 'the second load should have cost nothing').toBe(1);
  });

  it('is the same snapshot, not a re-derived one', async () => {
    const repo = new RemoteRepository();
    const first = await repo.load();
    repo.prime({ state: first });
    expect(await repo.load()).toBe(first);
  });

  it('is consumed once, so a later reload is fresh', async () => {
    /* The staleness guard. A primed value that survived startup would
       hand a refresh the state from page load, and the screen would
       quietly stop updating. */
    const repo = new RemoteRepository();
    repo.prime({ state: { facts: [] } as unknown as BusinessSnapshot });

    await repo.load();
    expect(count('/api/state')).toBe(0);

    await repo.load();
    expect(count('/api/state'), 'the reload must reach the network').toBe(1);

    await repo.load();
    expect(count('/api/state')).toBe(2);
  });
});

describe('a primed /api/me', () => {
  it('answers detailLevel without a request', async () => {
    const repo = new RemoteRepository();
    repo.prime({ me: { detailLevel: 'advanced' } });

    expect(await repo.detailLevel()).toBe('advanced');
    expect(count('/api/me')).toBe(0);
  });

  it('is consumed once', async () => {
    const repo = new RemoteRepository();
    repo.prime({ me: { detailLevel: 'advanced' } });

    await repo.detailLevel();
    await repo.detailLevel();
    expect(count('/api/me')).toBe(1);
  });

  it('still reads the value correctly when it has to ask', async () => {
    const repo = new RemoteRepository();
    expect(await repo.detailLevel()).toBe('advanced');
    expect(count('/api/me')).toBe(1);
  });

  it('treats anything that is not advanced as beginner', async () => {
    const repo = new RemoteRepository();
    repo.prime({ me: {} });
    expect(await repo.detailLevel()).toBe('beginner');
  });
});

describe('priming one thing does not clear the other', () => {
  it('keeps a primed snapshot when me is primed afterwards', async () => {
    const repo = new RemoteRepository();
    repo.prime({ state: { facts: [] } as unknown as BusinessSnapshot });
    repo.prime({ me: { detailLevel: 'beginner' } });

    await repo.load();
    await repo.detailLevel();
    expect(calls, 'neither should have reached the network').toEqual([]);
  });
});
