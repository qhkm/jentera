import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Join from '@/routes/Join';
import { KEYS } from '@/lib/storage';

const TOKEN = 'a'.repeat(64);

function mount(path = `/join?token=${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join" element={<Join />} />
        <Route path="/signin" element={<div>sign-in page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function api(me: number, accept?: { status: number; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/me')) return new Response(me === 200 ? '{"ok":true}' : '{"ok":false}', { status: me });
    if (url.endsWith('/api/team/invitations/accept') && accept) {
      return new Response(JSON.stringify(accept.body), { status: accept.status });
    }
    throw new Error(`unexpected ${url}`);
  }));
  return calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('joining a business from an invitation link', () => {
  it('keeps the token for later and sends a signed-out person to sign in', async () => {
    const calls = api(401);
    mount();
    expect(await screen.findByRole('link', { name: 'Sign in to accept' })).toHaveAttribute('href', '/signin');
    expect(localStorage.getItem(KEYS.joinToken)).toBe(TOKEN);
    expect(calls.map((c) => c.url)).toEqual([expect.stringMatching(/\/api\/me$/)]);
  });

  it('offers the token once signed in, then forgets it and opens the workspace', async () => {
    const calls = api(200, { status: 200, body: { ok: true, businessName: 'Kitakod' } });
    mount();
    await screen.findByText(/You have joined Kitakod/);
    const accept = calls.find((c) => c.url.endsWith('/api/team/invitations/accept'));
    expect(accept?.init?.method).toBe('POST');
    expect(JSON.parse(String(accept?.init?.body))).toEqual({ token: TOKEN });
    expect(localStorage.getItem(KEYS.joinToken)).toBeNull();
  });

  it('picks up a token left by an earlier visit when the link has none', async () => {
    localStorage.setItem(KEYS.joinToken, TOKEN);
    const calls = api(200, { status: 200, body: { ok: true, businessName: 'Kitakod' } });
    mount('/join');
    await screen.findByText(/You have joined Kitakod/);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ token: TOKEN });
  });

  it('shows the server\'s reason when the invitation is refused, and drops a dead token', async () => {
    api(200, { status: 410, body: { ok: false, err: 'This invitation is no longer valid. Ask the owner for a new one.' } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer valid');
    expect(localStorage.getItem(KEYS.joinToken)).toBeNull();
  });

  it('keeps the token when a different account holds the session, so the right one can finish', async () => {
    api(200, { status: 403, body: { ok: false, err: 'This invitation was sent to a different email address. Sign in with that address to accept it.' } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('different email address');
    expect(localStorage.getItem(KEYS.joinToken)).toBe(TOKEN);
    expect(screen.getByRole('link', { name: 'Sign in with another account' })).toBeInTheDocument();
  });

  it('says so when the link carries no token at all', async () => {
    mount('/join');
    expect(await screen.findByRole('alert')).toHaveTextContent('missing its invitation');
  });
});
