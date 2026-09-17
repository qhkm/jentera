import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { renderToString } from 'react-dom/server';
import { AnalyticsSettings, GoogleAnalytics } from '@/components/GoogleAnalytics';

const state = vi.hoisted(() => ({
  choice: null as 'allowed' | 'denied' | null,
  private: false,
  eligible: true,
  storageWorks: true,
  track: vi.fn(),
}));

vi.mock('@/lib/google-analytics', () => ({
  ANALYTICS_CHOICE_EVENT: 'jentera:analytics-choice',
  ANALYTICS_CHOICE_KEY: 'jentera-google-analytics-choice-v1',
  analyticsPrivacyOptOut: () => state.private,
  readAnalyticsChoice: () => state.choice,
  publicAnalyticsPage: () => state.eligible ? new URL('https://jentera.ai/') : null,
  saveAnalyticsChoice: (next: 'allowed' | 'denied') => {
    if (!state.storageWorks) return false;
    state.choice = next;
    window.dispatchEvent(new Event('jentera:analytics-choice'));
    return true;
  },
  googleAnalytics: { trackPage: state.track, stop: vi.fn() },
}));

beforeEach(() => {
  state.choice = null;
  state.private = false;
  state.eligible = true;
  state.storageWorks = true;
  state.track.mockClear();
});

afterEach(cleanup);

describe('optional Google analytics UI', () => {
  it('offers equal accept and decline choices without blocking access', async () => {
    render(<MemoryRouter><GoogleAnalytics /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Analytics choice' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Allow analytics' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Privacy & settings' })).toHaveAttribute('href', '/privacy#analytics-settings');
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(state.choice).toBe('denied');
    expect(screen.queryByRole('region', { name: 'Analytics choice' })).not.toBeInTheDocument();
  });

  it('allows acceptance and tells the route observer to update', async () => {
    render(<StrictMode><MemoryRouter><GoogleAnalytics /></MemoryRouter></StrictMode>);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow analytics' }));
    await waitFor(() => expect(state.choice).toBe('allowed'));
    expect(state.track).toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Analytics choice' })).not.toBeInTheDocument();
  });

  it('explains storage failure and does not mark consent as allowed', async () => {
    state.storageWorks = false;
    render(<MemoryRouter><GoogleAnalytics /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow analytics' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Analytics remains off');
    expect(state.choice).toBeNull();
  });

  it.each(['private', 'eligible'] as const)('does not prompt when %s prevents tracking', (field) => {
    state[field] = field === 'private';
    render(<MemoryRouter><GoogleAnalytics /></MemoryRouter>);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('provides Malay choices on the Malay landing page', async () => {
    render(<MemoryRouter initialEntries={['/ms']}><GoogleAnalytics /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Pilihan analitik' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tidak, terima kasih' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Benarkan analitik' })).toBeVisible();
  });

  it('lets visitors revisit and change preferences in the privacy notice', async () => {
    state.choice = 'denied';
    render(<AnalyticsSettings />);
    expect(screen.getByRole('button', { name: 'Disable Google analytics' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Enable Google analytics' }));
    expect(screen.getByRole('button', { name: 'Enable Google analytics' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('explains a browser privacy override instead of encouraging consent', () => {
    state.private = true;
    render(<AnalyticsSettings />);
    expect(screen.getByText(/off because of your browser privacy preference/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders no consent banner during prerendering, avoiding hydration differences', () => {
    expect(renderToString(<MemoryRouter><GoogleAnalytics /></MemoryRouter>)).toBe('');
  });
});
