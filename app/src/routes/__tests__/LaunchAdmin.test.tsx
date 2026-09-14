import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LaunchAdmin from '../LaunchAdmin';
afterEach(() => vi.unstubAllGlobals());
describe('launch admin page', () => {
  it('does not show controls to unauthorized visitors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    render(<MemoryRouter><LaunchAdmin /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('only to the launch administrator');
    expect(screen.queryByRole('button', { name: 'Create trial code' })).not.toBeInTheDocument();
  });
  it('creates a code only after explicit submission and shows it once', async () => {
    const data = {totals:{waitlist:0,invited:0,redeemed:0,active:0},rows:[],hasMore:false};
    const fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? {email:'trial@example.com',code:'private-code',expiresAt:'2026-10-01T00:00:00Z'} : data));
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter><LaunchAdmin /></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Recipient email'),'trial@example.com');
    expect(fetch.mock.calls.every(([,init]) => init?.method !== 'POST')).toBe(true);
    await user.click(screen.getByRole('button',{name:'Create trial code'}));
    expect(await screen.findByText('private-code')).toBeVisible();
    expect(screen.getByText(/No email has been sent/)).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Hide code'}));
    expect(screen.queryByText('private-code')).not.toBeInTheDocument();
    expect(localStorage.getItem('private-code')).toBeNull();
  });
  it('shows observed activation stages and keeps missing stages visibly incomplete', async () => {
    const instant = '2026-09-14T10:00:00.000Z';
    const person = {
      email: 'trial@example.com', joined_at: null, invited_at: instant, redeemed_at: instant,
      trial_expires_at: instant, access_kind: 'trial', access_expires_at: instant, revoked_at: null,
      onboardingCompletedAt: instant, computerReadyAt: instant, installedAppOpenedAt: instant,
      pushEnabledAt: instant, lastPushAcceptedAt: instant, firstCompletedRequest: instant,
      firstReminderScheduledAt: instant, firstReminderDeliveredAt: instant,
      firstReminderPushAcceptedAt: null, lastPushIssue: null,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ totals: { waitlist: 0, invited: 1, redeemed: 1, active: 1 }, rows: [person], hasMore: false })));
    render(<MemoryRouter><LaunchAdmin /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Activation funnel' })).toBeVisible();
    expect(screen.getByText('Opened installed app')).toBeVisible();
    expect(screen.getByText('Reminder accepted by push service')).toBeVisible();
    expect(screen.getByText(/browsers provide no proof that a person saw it/i)).toBeVisible();
  });
});
