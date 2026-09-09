import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('RepositoryGate session transitions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://api.jentera.test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([undefined, 1, 2])('passes only supported Routines discovery from the existing me response: %s', async (apiVersion) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ userId: 'user-77', features: { routines: { apiVersion } } }))
      .mockResolvedValueOnce(json({ snapshot: { onboarded: true } }));
    vi.stubGlobal('fetch', fetch);
    const { RepositoryGate, useRoutinesEnabled } = await import('@/lib/repo/gate');
    function Probe() { return <div>{useRoutinesEnabled() ? 'routines available' : 'routines hidden'}</div>; }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    await screen.findByText(apiVersion === 1 ? 'routines available' : 'routines hidden');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to public onboarding when logout races the state load', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, detailLevel: 'beginner' }))
      .mockResolvedValueOnce(json({ ok: false, err: 'not signed in' }, 401));
    vi.stubGlobal('fetch', fetch);

    const { RepositoryGate, useSignedIn } = await import('@/lib/repo/gate');
    const { useSnapshot } = await import('@/lib/repo/context');

    function Probe() {
      const snapshot = useSnapshot();
      return (
        <div>
          {useSignedIn() ? 'signed in' : 'signed out'}
          {snapshot.onboarded ? ' onboarded' : ' fresh'}
        </div>
      );
    }

    render(
      <RepositoryGate>
        <Probe />
      </RepositoryGate>,
    );

    expect(await screen.findByText('signed out fresh')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('exposes the session user id as the account key for per-browser state', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, userId: 'user-77', detailLevel: 'beginner' }))
      .mockResolvedValueOnce(json({ snapshot: { onboarded: true } }));
    vi.stubGlobal('fetch', fetch);

    const { RepositoryGate, useAccountKey, useSignedIn } = await import('@/lib/repo/gate');

    function Probe() {
      return <div>{useSignedIn() ? 'signed in' : 'signed out'} as {useAccountKey() ?? 'nobody'}</div>;
    }

    render(
      <RepositoryGate>
        <Probe />
      </RepositoryGate>,
    );

    expect(await screen.findByText('signed in as user-77')).toBeInTheDocument();
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
