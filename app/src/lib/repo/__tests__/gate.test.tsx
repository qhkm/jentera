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

  it('passes the server-confirmed email without a second identity request', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, userId: 'user-77', email: 'owner@business.example' }))
      .mockResolvedValueOnce(json({ snapshot: { onboarded: true } }));
    vi.stubGlobal('fetch', fetch);
    localStorage.setItem('aisar-email', 'previous@business.example');
    const { RepositoryGate, useAccountEmail } = await import('@/lib/repo/gate');
    function Probe() { return <p>{useAccountEmail() ?? 'no signed-in email'}</p>; }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    expect(await screen.findByText('owner@business.example')).toBeInTheDocument();
    expect(screen.queryByText('previous@business.example')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('discards the email if sign-out races the state load', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, userId: 'user-77', email: 'owner@business.example' }))
      .mockResolvedValueOnce(json({ err: 'not signed in' }, 401));
    vi.stubGlobal('fetch', fetch);
    const { RepositoryGate, useAccountEmail } = await import('@/lib/repo/gate');
    function Probe() { return <p>{useAccountEmail() ?? 'no signed-in email'}</p>; }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    expect(await screen.findByText('no signed-in email')).toBeInTheDocument();
    expect(screen.queryByText('owner@business.example')).not.toBeInTheDocument();
  });

  it('updates the displayed identity on account changes and clears it when signed out', async () => {
    const { SignedInProvider, useAccountEmail } = await import('@/lib/repo/gate');
    function Probe() { return <p>{useAccountEmail() ?? 'no signed-in email'}</p>; }
    const view = render(<SignedInProvider value email="first@business.example"><Probe /></SignedInProvider>);
    expect(screen.getByText('first@business.example')).toBeInTheDocument();
    view.rerender(<SignedInProvider value email="second@business.example"><Probe /></SignedInProvider>);
    expect(screen.getByText('second@business.example')).toBeInTheDocument();
    expect(screen.queryByText('first@business.example')).not.toBeInTheDocument();
    view.rerender(<SignedInProvider value={false} email="second@business.example"><Probe /></SignedInProvider>);
    expect(screen.getByText('no signed-in email')).toBeInTheDocument();
    expect(screen.queryByText('second@business.example')).not.toBeInTheDocument();
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
