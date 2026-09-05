import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';

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

  it.each([403, 429, 503, 'offline'])('offers retry instead of demo on session failure %s', async (failure) => {
    localStorage.setItem('aisar-onboarding-draft-v1', '{"step":2,"desc":"My bakery"}');
    const fetch = vi.fn();
    if (failure === 'offline') fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else fetch.mockResolvedValueOnce(json({}, Number(failure)));
    fetch.mockResolvedValueOnce(json({ detailLevel: 'beginner' }))
      .mockImplementation(() => Promise.resolve(json({
        snapshot: { onboarded: true, setupDone: false, bizName: 'Saved bakery' },
      })));
    vi.stubGlobal('fetch', fetch);

    const { RepositoryGate, useSignedIn } = await import('@/lib/repo/gate');
    const { useSnapshot } = await import('@/lib/repo/context');
    function Probe() {
      const snapshot = useSnapshot();
      return <div>{useSignedIn() ? snapshot.bizName : 'demo'}</div>;
    }
    render(<StrictMode><RepositoryGate><Probe /></RepositoryGate></StrictMode>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check your session');
    expect(screen.queryByText('demo')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Saved bakery')).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/me'))).toHaveLength(2);
    expect(localStorage.getItem('aisar-onboarding-draft-v1')).toContain('My bakery');
  });

  it('allows the demo after a confirmed signed-out session', async () => {
    const fetch = vi.fn().mockResolvedValue(json({}, 401));
    vi.stubGlobal('fetch', fetch);
    const { RepositoryGate, useSignedIn } = await import('@/lib/repo/gate');
    function Probe() { return <div>{useSignedIn() ? 'signed in' : 'demo'}</div>; }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    expect(await screen.findByText('demo')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
