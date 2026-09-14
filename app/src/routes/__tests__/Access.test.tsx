import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import Access from '../Access';

vi.mock('@/lib/turnstile', () => ({ useTurnstile: () => ({ enabled: false, getToken: async () => undefined, reset: vi.fn(), attach: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
function mount(signedIn: boolean, route = '/waitlist') {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ signedIn, access: { allowed: false } }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter initialEntries={[route]}><Access /></MemoryRouter>);
  return { fetch, user: userEvent.setup() };
}
describe('waitlist and access page', () => {
  it('carries a private invitation to sign-in in the fragment, not storage', async () => {
    const code = 'a'.repeat(48);
    window.history.replaceState(null, '', `/access?invite=1#code=${code}`);
    const { fetch } = mount(false, '/access?invite=1');
    expect(await screen.findByRole('heading', { name: 'You’re invited to try Jentera.' })).toBeVisible();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to start your trial' })).toHaveAttribute('href', `/signin#code=${code}`);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('jentera.pending-trial-invite.v1')).toBeNull();
  });
  it('restores the link after login but only redeems on an explicit click', async () => {
    const code = 'b'.repeat(48);
    window.history.replaceState(null, '', `/access?invite=1#code=${code}`);
    const { fetch, user } = mount(true, '/access');
    const start = await screen.findByRole('button', { name: 'Start my 3-day trial' });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(Response.json({ err: 'Already claimed.' }, { status: 400 }));
    await user.click(start);
    expect(await screen.findByText('Already claimed.')).toBeVisible();
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ code });
  });
  it('ignores expired stored invitations', async () => {
    localStorage.setItem('jentera.pending-trial-invite.v1', JSON.stringify({ code: 'c'.repeat(48), savedAt: Date.now() - 8 * 86400000 }));
    mount(false);
    expect(screen.queryByText('You’re invited to try Jentera.')).not.toBeInTheDocument();
    expect(localStorage.getItem('jentera.pending-trial-invite.v1')).toBeNull();
  });
  it('collects a waitlist address without creating an account', async () => {
    const { fetch, user } = mount(false);
    expect(screen.queryByText('Have a trial code?')).not.toBeInTheDocument();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    await user.type(screen.getByLabelText('Email address'), 'visitor@example.com');
    await user.click(screen.getByRole('button', { name: 'Get early access' }));
    expect(await screen.findByRole('heading', { name: 'You’re on the list.' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Get early access' })).not.toBeInTheDocument();
    expect(fetch.mock.calls[1][0]).toMatch(/\/api\/waitlist$/);
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
  });
  it('requires explicit redemption by a signed-in account and reports errors', async () => {
    const { fetch, user } = mount(true, '/access?invite=1');
    await screen.findByLabelText('Invite code');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ err: 'Invalid or unavailable invite code.' }), { status: 400 }));
    await user.type(screen.getByLabelText('Invite code'), 'x'.repeat(32));
    await user.click(screen.getByRole('button', { name: 'Start my 3-day trial' }));
    expect(await screen.findByText('Invalid or unavailable invite code.')).toBeVisible();
    expect(fetch.mock.calls[1][0]).toMatch(/\/api\/access\/redeem$/);
  });
  it('hides trial redemption on the normal signed-in access page', async () => {
    mount(true, '/access');
    await screen.findByRole('button', { name: 'Log out' });
    expect(screen.queryByText('Have a trial code?')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
  });
  it('offers sign-in only when explicitly opening the invite flow', async () => {
    mount(false, '/access?invite=1');
    expect(await screen.findByRole('link', { name: 'Sign in to start your trial' })).toBeVisible();
  });
  it('logs out and keeps the visitor on the waitlist', async () => {
    const { fetch, user } = mount(true);
    await screen.findByRole('button', { name: 'Log out' });
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('link', { name: /Already have access/ })).toBeVisible();
    expect(fetch.mock.calls[1]).toEqual([expect.stringMatching(/\/api\/auth\/logout$/), { method: 'POST', credentials: 'include' }]);
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });
  it('keeps logout available when the request fails', async () => {
    const { fetch, user } = mount(true);
    await screen.findByRole('button', { name: 'Log out' });
    fetch.mockRejectedValueOnce(new Error('Offline'));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('Could not log out. Please try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeEnabled();
  });
});
