import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import Subscribe from '../Subscribe';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const status = (overrides = {}) => ({ ok: true, checkoutEnabled: true, mode: 'live', activation: 'inactive',
  offer: { initialMonthlyAmount: 99, introductoryMonths: 3, renewalMonthlyAmount: 199, currency: 'MYR' }, state: null, ...overrides });
function mount(body = status(), route = '/subscribe', code = 200) {
  const fetch = vi.fn().mockImplementation(async () => Response.json(body, { status: code }));
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter initialEntries={[route]}><Subscribe /></MemoryRouter>);
  return { fetch, user: userEvent.setup() };
}
describe('server-confirmed subscription checkout', () => {
  it('offers the platform first while free chats remain, without creating checkout', async () => {
    const { fetch } = mount(status({ preview: { limit: 10, used: 3, remaining: 7 } }));
    expect(await screen.findByRole('link', { name: /Try Jentera — 7 free chats left/ })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('button', { name: /Subscribe —/ })).toHaveClass('btn-outline');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/No payment needed for your free chats/)).toBeVisible();
  });
  it('shows an upgrade after all ten free chats without offering a new trial', async () => {
    mount(status({ preview: { limit: 10, used: 10, remaining: 0 } }));
    expect(await screen.findByRole('heading', { name: 'Your free chats are complete.' })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Try Jentera/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subscribe — RM99/ })).toHaveClass('btn-primary');
    expect(screen.getByRole('link', { name: 'Back to website' })).toBeVisible();
  });
  it('never offers preview access from inconsistent quota data or a payment review hold', async () => {
    mount(status({ activation: 'review', preview: { limit: 10, used: 0, remaining: 10 } }));
    expect(await screen.findByText(/Access is paused/)).toBeVisible();
    expect(screen.queryByRole('link', { name: /Try Jentera/ })).not.toBeInTheDocument();
  });
  it('requires identity before creating any checkout', async () => {
    const { fetch } = mount({} as ReturnType<typeof status>, '/subscribe', 401);
    expect(await screen.findByRole('link', { name: 'Create account or sign in' })).toHaveAttribute('href', '/signin');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Subscribe —/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });
  it('discloses the real introductory price, renewal, fair-use and policy links', async () => {
    mount();
    expect(await screen.findByRole('button', { name: /Subscribe — RM99/ })).toBeEnabled();
    expect(screen.getByText(/then RM199\/month from month 4/)).toBeVisible();
    expect(screen.getByText(/not unlimited compute/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'terms' })).toHaveAttribute('href', '/terms');
  });
  it('uses the simplified launch benefits without promising a mapping session', async () => {
    mount();
    await screen.findByRole('button', { name: /Subscribe — RM99/ });
    const benefits = screen.getByRole('list', { name: 'Launch plan inclusions' });
    expect(within(benefits).getAllByRole('listitem')).toHaveLength(6);
    expect(benefits).toHaveTextContent('Its own dedicated computer');
    expect(benefits).toHaveTextContent('AI usage included for day-to-day work');
    expect(benefits).toHaveTextContent('Private WhatsApp support group');
    expect(benefits).toHaveTextContent('Direct access to the founder');
    expect(benefits).not.toHaveTextContent('Automation Mapping');
    expect(screen.queryByText(/Automation Mapping/)).not.toBeInTheDocument();
    expect(screen.getByText(/Your private founder-group invitation/)).toHaveTextContent('after payment is confirmed');
    expect(screen.queryByRole('link', { name: /WhatsApp|founder-group/ })).not.toBeInTheDocument();
  });
  it('does not offer another introductory discount to a returning account', async () => {
    mount(status({ offer: { initialMonthlyAmount: 199, introductoryMonths: 0, renewalMonthlyAmount: 199, currency: 'MYR' } }));
    expect(await screen.findByRole('button', { name: /Subscribe — RM199/ })).toBeVisible();
    expect(screen.getByText(/already used the introductory offer/)).toBeVisible();
    expect(screen.queryByText(/then RM199\/month from month 4/)).not.toBeInTheDocument();
  });
  it('provides an obvious public-site exit and sign-out action for unpaid accounts', async () => {
    const { fetch } = mount();
    await screen.findByRole('button', { name: /Subscribe — RM99/ });
    expect(screen.getByRole('link', { name: 'Back to website' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps the public-site exit available when billing status cannot be loaded', async () => {
    mount({} as ReturnType<typeof status>, '/subscribe', 503);
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Back to website' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
  it('revokes the session before returning to the public site', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { replace, hash: '', pathname: '/subscribe', search: '' });
    const { fetch, user } = mount();
    await screen.findByRole('button', { name: /Subscribe —/ });
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(fetch.mock.calls.find(([, options]) => options.method === 'POST')).toEqual([
      expect.stringMatching(/\/api\/auth\/logout$/), expect.objectContaining({ method: 'POST', credentials: 'include', signal: expect.any(AbortSignal) }),
    ]);
    expect(screen.queryByRole('button', { name: /Subscribe —/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });
  it('does not claim sign-out or navigate when session revocation fails', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { replace, hash: '', pathname: '/subscribe', search: '' });
    const { fetch, user } = mount();
    await screen.findByRole('button', { name: /Subscribe —/ });
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
  it('never creates a checkout or grants access from forged success parameters', async () => {
    const { fetch } = mount(status({ checkoutEnabled: false }), '/subscribe?checkout=complete&paid=true');
    expect(await screen.findByText(/No payment can be taken/)).toBeVisible();
    expect(screen.queryByRole('link', { name: /Go to my workspace/ })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('method');
  });
  it('fails closed when status is unavailable', async () => {
    mount({} as ReturnType<typeof status>, '/subscribe', 503);
    expect(await screen.findByRole('alert')).toHaveTextContent('No access was granted');
    expect(screen.queryByRole('button', { name: /Subscribe —/ })).not.toBeInTheDocument();
  });
  it('reuses the same request key after a provider failure', async () => {
    const { fetch, user } = mount();
    const button = await screen.findByRole('button', { name: /Subscribe —/ });
    fetch.mockResolvedValue(Response.json({ ok: false, err: 'Try again.' }, { status: 502 }));
    await user.click(button); await screen.findByRole('alert'); await user.click(button);
    const writes = fetch.mock.calls.filter(([, options]) => options.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[0][1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(writes[1][1].headers['Idempotency-Key']).toBe(writes[0][1].headers['Idempotency-Key']);
    expect(JSON.parse(writes[0][1].body)).toEqual({ plan: 'launch' });
  });
  it('rejects a provider redirect outside the approved Stripe host', async () => {
    const { fetch, user } = mount();
    await screen.findByRole('button', { name: /Subscribe —/ });
    fetch.mockResolvedValue(Response.json({ ok: true, url: 'https://attacker.example/pay' }));
    await user.click(screen.getByRole('button', { name: /Subscribe —/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('secure Stripe checkout');
  });
  it('only exposes a workspace link after server-confirmed activation', async () => {
    mount(status({ activation: 'active' }));
    expect(await screen.findByRole('link', { name: /Go to my workspace/ })).toHaveAttribute('href', '/app');
    expect(screen.queryByRole('button', { name: /Subscribe —/ })).not.toBeInTheDocument();
  });
  it('shows a review hold without offering a duplicate subscription', async () => {
    mount(status({ activation: 'review' }));
    expect(await screen.findByText(/Access is paused/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Subscribe —/ })).not.toBeInTheDocument();
  });
});
