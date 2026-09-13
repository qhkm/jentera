import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import Access from '../Access';

vi.mock('@/lib/turnstile', () => ({ useTurnstile: () => ({ enabled: false, getToken: async () => undefined, reset: vi.fn(), attach: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
function mount(signedIn: boolean) {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ signedIn, access: { allowed: false } }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><Access /></MemoryRouter>);
  return { fetch, user: userEvent.setup() };
}
describe('waitlist and access page', () => {
  it('collects a waitlist address without creating an account', async () => {
    const { fetch, user } = mount(false);
    await screen.findByRole('link', { name: 'Sign in to redeem your code' });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 202 }));
    await user.type(screen.getByLabelText('Email address'), 'visitor@example.com');
    await user.click(screen.getByRole('button', { name: 'Join waitlist' }));
    expect(await screen.findByText(/You’re on the waitlist/)).toBeVisible();
    expect(fetch.mock.calls[1][0]).toMatch(/\/api\/waitlist$/);
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
  });
  it('requires explicit redemption by a signed-in account and reports errors', async () => {
    const { fetch, user } = mount(true);
    await screen.findByLabelText('Invite code');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ err: 'Invalid or unavailable invite code.' }), { status: 400 }));
    await user.type(screen.getByLabelText('Invite code'), 'x'.repeat(32));
    await user.click(screen.getByRole('button', { name: 'Start my 3-day trial' }));
    expect(await screen.findByText('Invalid or unavailable invite code.')).toBeVisible();
    expect(fetch.mock.calls[1][0]).toMatch(/\/api\/access\/redeem$/);
  });
});
