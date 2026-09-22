import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LaunchAnnouncement } from '@/components/LaunchAnnouncement';
import { AccountWelcome } from '@/components/AccountWelcome';

describe('public launch announcement', () => {
  it('shows both prices and duration with a direct link to the launch offer', () => {
    render(<MemoryRouter><LaunchAnnouncement /></MemoryRouter>);
    const bar = screen.getByRole('complementary', { name: 'Jentera launch announcement' });
    expect(bar).toHaveTextContent('RM99/month for your first 3 months, then RM199/month');
    expect(bar).not.toHaveTextContent('No payment today');
    expect(within(bar).getByRole('link', { name: 'View launch offer' })).toHaveAttribute('href', '/#pricing');
    expect(bar.querySelector('a[href*="chat.whatsapp.com"]')).toBeNull();
  });
  it('keeps the notice and action compact without a second headline or stacked link label', () => {
    render(<MemoryRouter><LaunchAnnouncement /></MemoryRouter>);
    const bar = screen.getByRole('complementary', { name: 'Jentera launch announcement' });
    expect(bar).not.toHaveTextContent('Meet your first AI Staff.');
    expect(bar.querySelector('.launch-announcement__copy')).toHaveTextContent('RM199/month');
    expect(within(bar).getByRole('link')).not.toHaveTextContent('No payment today');
    expect(bar.querySelector('.launch-announcement__link small')).toBeNull();
  });
  it('lets the browser navigate to the pricing fragment instead of only updating the SPA URL', () => {
    render(<MemoryRouter initialEntries={['/signin']}><LaunchAnnouncement /></MemoryRouter>);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(screen.getByRole('link', { name: 'View launch offer' }), click);
    expect(click.defaultPrevented).toBe(false);
  });
  it('dismisses without persisting private or new flow state', async () => {
    const before = JSON.stringify(localStorage);
    render(<MemoryRouter><LaunchAnnouncement /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss launch announcement' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(JSON.stringify(localStorage)).toBe(before);
  });
});

describe('signed-in welcome presentation', () => {
  it('welcomes signed-in users without claiming payment, subscription or computer readiness', () => {
    render(<AccountWelcome />);
    expect(screen.getByRole('region', { name: 'Welcome to Jentera!' })).toHaveTextContent('You’re signed in');
    expect(screen.getByRole('region')).toHaveTextContent('prepare your first useful job');
    expect(screen.getByRole('region')).not.toHaveTextContent('invitation-only');
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('guides onboarding toward the first job in Bahasa Malaysia', () => {
    render(<AccountWelcome lang="bm" setup />);
    expect(screen.getByRole('region', { name: 'Selamat datang ke Jentera!' })).toHaveTextContent('tugas pertama');
    expect(screen.getByRole('region')).not.toHaveTextContent('langganan aktif');
  });
});
