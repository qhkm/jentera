import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepository } from '@/lib/repo/local';
import { migrateLocalToRemote } from '@/lib/repo/migrate';
import { RemoteRepository } from '@/lib/repo/remote';
import { KEYS } from '@/lib/storage';

describe('first authenticated migration', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('moves demo answers without copying its completion gates', async () => {
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, '');
      paths.push(path);
      if (path === '/api/state/business') {
        return new Response(JSON.stringify({ ok: true, businessId: crypto.randomUUID() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    }));

    const local = new LocalRepository();
    await local.setBizType('restaurant');
    await local.setOnboarded(true);
    await local.setSetupDone(true);
    /* A light demo theme must not pin a real business to light — that is
       exactly the bug that left early sign-ups (Kitakod Ventures, ...)
       permanently light after a stale aisar-theme localStorage leaked
       through the migration. */
    await local.setTheme('light');

    await migrateLocalToRemote(local, new RemoteRepository());

    expect(paths).toEqual(['/api/state/business']);
    expect(paths).not.toContain('/api/state/theme');
    expect(paths).not.toContain('/api/state/onboarded');
    expect(paths).not.toContain('/api/state/setup-done');
    expect(JSON.parse(localStorage.getItem(KEYS.onboardingDraft) ?? '{}')).toMatchObject({
      step: 5,
      completedDemo: true,
    });
  });
});
