import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import Access from '../Access';

vi.mock('@/lib/turnstile', () => ({ useTurnstile: () => ({ enabled: false, getToken: async () => undefined, reset: vi.fn(), attach: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
function mount(signedIn: boolean, route = '/waitlist', checkoutEnabled = false) {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ signedIn, access: { allowed: false }, billing: { checkoutEnabled } }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/subscribe" element={<h1>Choose your plan</h1>} />
    <Route path="*" element={<Access />} />
  </Routes></MemoryRouter>);
  return { fetch, user: userEvent.setup() };
}
describe('waitlist and access page', () => {
  it('continues a verified unpaid account to its plan only when server checkout is open', async () => {
    const { fetch } = mount(true, '/access', true);
    expect(await screen.findByRole('heading', { name: 'Choose your plan' })).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('method');
  });
  it('keeps signed-out users at sign-in even when checkout is open', async () => {
    const { fetch } = mount(false, '/access?paid=true&checkoutEnabled=true', true);
    expect(await screen.findByRole('link', { name: 'Get my AI staff' })).toHaveAttribute('href', '/signin?mode=signup');
    expect(screen.queryByRole('heading', { name: 'Choose your plan' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps an explicit waitlist visit available when checkout is open', async () => {
    mount(true, '/waitlist', true);
    expect(await screen.findByRole('link', { name: 'Choose my launch plan' })).toHaveAttribute('href', '/subscribe');
    expect(screen.queryByRole('heading', { name: 'Choose your plan' })).not.toBeInTheDocument();
  });
  it('does not replace a private trial invitation with a paid plan', async () => {
    window.history.replaceState(null, '', `/access#code=${'d'.repeat(48)}`);
    const { fetch } = mount(true, '/access', true);
    expect(await screen.findByRole('button', { name: 'Start my 3-day trial' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Choose your plan' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves explicit trial-code entry when checkout is open', async () => {
    mount(true, '/access?invite=1', true);
    expect(await screen.findByLabelText('Invite code')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Choose your plan' })).not.toBeInTheDocument();
  });
  it('welcomes only a confirmed signed-in visitor, without granting access', async () => {
    const { fetch } = mount(true);
    expect(await screen.findByRole('region', { name: 'Welcome to Jentera!' })).toHaveTextContent('You’re signed in');
    expect(screen.getByRole('region', { name: 'Welcome to Jentera!' })).toHaveTextContent('prepare your first useful job');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not infer a welcome or paid access from crafted query parameters', async () => {
    const { fetch } = mount(false, '/access?welcome=1&paid=true');
    await screen.findByRole('link', { name: /Already have access/ });
    expect(screen.queryByRole('region', { name: 'Welcome to Jentera!' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('discloses the introductory and renewal prices without implying checkout exists', async () => {
    mount(false);
    expect(await screen.findByRole('heading', { name: 'Your first AI staff.' })).toBeVisible();
    expect(screen.getByText(/RM99\/month for 3 months, then RM199\/month from month 4/)).toBeVisible();
    expect(screen.getByText(/Joining the waitlist is free and does not start a subscription/)).toBeVisible();
    expect(screen.queryByText(/Automation Mapping/)).not.toBeInTheDocument();
    expect(screen.getByText(/The launch offer:/)).toHaveTextContent('Private WhatsApp support and direct founder access are available after payment is confirmed.');
    expect(screen.queryByRole('button', { name: /pay|subscribe|start my ai staff/i })).not.toBeInTheDocument();
  });
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
