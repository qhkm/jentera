import { describe, expect, it } from 'vitest';
import { AppsError } from '@/lib/apps/api';
import { createQueryClient, GC_MS, retryOnce, STALE_MS } from '../client';

describe('the page query client', () => {
  it('keeps data fresh for 30 s, drops it after 30 min unused, reads again on focus, and never retries a write', () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(STALE_MS).toBe(30_000);
    expect(GC_MS).toBe(1_800_000);
    expect(defaults.queries).toMatchObject({ staleTime: STALE_MS, gcTime: GC_MS, refetchOnWindowFocus: true, retry: retryOnce });
    expect(defaults.mutations).toMatchObject({ retry: false });
  });

  it('sends a write and a read even while the browser reports offline, so a failure shows at once', () => {
    // TanStack's default ('online') would hold a tap made offline and send it on reconnect.
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.mutations).toMatchObject({ networkMode: 'always' });
    expect(defaults.queries).toMatchObject({ networkMode: 'always' });
  });

  it('retries a read once, and only on a failure that can be temporary', () => {
    expect(retryOnce(0, new AppsError('NETWORK', 0, false))).toBe(true);
    expect(retryOnce(0, new AppsError('REQUEST_FAILED', 503))).toBe(true);
    expect(retryOnce(0, new AppsError('INVALID_RESPONSE', 200))).toBe(true);
    expect(retryOnce(0, new AppsError('NOT_FOUND', 404))).toBe(false);
    expect(retryOnce(0, new AppsError('FORBIDDEN', 403))).toBe(false);
    // Notifications throw a plain Error with no status: once on any failure.
    expect(retryOnce(0, new Error('Could not load notifications.'))).toBe(true);
    // Never a second retry.
    expect(retryOnce(1, new AppsError('NETWORK', 0, false))).toBe(false);
    expect(retryOnce(1, new Error('Could not load notifications.'))).toBe(false);
  });
});
