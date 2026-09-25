import { StrictMode, useContext } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Fresh modules per test (the gate reads VITE_API_URL at import), so the
   gate, the scope and the query library are all imported after the reset. */
describe('the query cache under RepositoryGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'https://api.jentera.test');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('gives a signed-in page one client, keyed by the session business, even under StrictMode', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ ok: true, userId: 'user-1', businessId: 'biz-1' }))
      .mockResolvedValueOnce(json({ snapshot: { onboarded: true } })));
    const { RepositoryGate } = await import('@/lib/repo/gate');
    const { useBusinessId } = await import('@/lib/query/scope');
    const { QueryClientContext } = await import('@tanstack/react-query');
    const seen = new Set<unknown>();
    function Probe() {
      seen.add(useContext(QueryClientContext));
      return <p>business {useBusinessId() ?? 'none'}</p>;
    }
    render(<StrictMode><RepositoryGate><Probe /></RepositoryGate></StrictMode>);
    expect(await screen.findByText('business biz-1')).toBeInTheDocument();
    expect(seen.size).toBe(1);
    expect([...seen][0]).toBeDefined();
  });

  it('gives the anonymous demo no client and no business', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ ok: false, err: 'not signed in' }, 401)));
    const { RepositoryGate } = await import('@/lib/repo/gate');
    const { useBusinessId } = await import('@/lib/query/scope');
    const { QueryClientContext } = await import('@tanstack/react-query');
    function Probe() {
      const client = useContext(QueryClientContext);
      return <p>{client ? 'client' : 'no client'} / {useBusinessId() ?? 'none'}</p>;
    }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    expect(await screen.findByText('no client / none')).toBeInTheDocument();
  });

  it('keys a first sign-in by the business it has just created', async () => {
    let created = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/me')) return json({ ok: true, userId: 'user-2', businessId: null });
      if (url.endsWith('/api/state/business') && init?.method === 'POST') {
        created = true;
        return json({ ok: true, businessId: 'biz-new' });
      }
      if (url.endsWith('/api/state')) return created ? json({ snapshot: { onboarded: false } }) : json({ ok: false, code: 'NO_BUSINESS' }, 404);
      throw new TypeError('offline');
    }));
    const { RepositoryGate } = await import('@/lib/repo/gate');
    const { useBusinessId } = await import('@/lib/query/scope');
    function Probe() { return <p>business {useBusinessId() ?? 'none'}</p>; }
    render(<RepositoryGate><Probe /></RepositoryGate>);
    expect(await screen.findByText('business biz-new')).toBeInTheDocument();
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
