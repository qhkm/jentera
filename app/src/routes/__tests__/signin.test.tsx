import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import SignIn from '@/routes/SignIn';

vi.mock('@/lib/analytics', () => ({ trackActivation: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function mount(path = '/signin') {
  render(<MemoryRouter initialEntries={[path]}><SignIn /></MemoryRouter>);
}

describe('email sign-in recovery', () => {
  it.each([429, 503, 'offline'])('does not claim delivery after %s and retries with the retained email', async (failure) => {
    const fetch = vi.fn();
    if (failure === 'offline') fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else fetch.mockResolvedValueOnce(new Response(null, { status: Number(failure) }));
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    mount();
    await userEvent.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a link instead' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      failure === 429 ? 'Wait a minute' : failure === 'offline' ? 'Check your connection' : 'Please try again',
    );
    expect(screen.queryByText('Check your inbox')).toBeNull();
    expect(screen.getByLabelText('Email address')).toHaveValue('owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a link instead' }));
    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(screen.getByText(/If.*has a Jentera account/)).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/auth/request'), expect.objectContaining({
      body: JSON.stringify({ email: 'owner@example.test' }),
      credentials: 'include',
    }));
  });

  it('lets a signup resend the verification link and correct their email', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    mount('/signin?mode=signup');
    await userEvent.type(screen.getByLabelText('Email address'), 'owner@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(screen.getByText(/Telegram is optional/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resend email link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send your link');
    await userEvent.click(screen.getByRole('button', { name: 'Resend email link' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/auth/request'), expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email address')).toHaveValue('owner@example.test');
  });

  it('asks for a new link when the old one expired without claiming to have sent one', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    mount('/signin?error=expired');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email to request a new one');
    expect(fetch).not.toHaveBeenCalled();
  });
});
