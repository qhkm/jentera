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
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
