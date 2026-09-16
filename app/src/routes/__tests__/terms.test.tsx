import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Terms from '@/routes/Terms';

function mount() {
  return render(<MemoryRouter><Terms /></MemoryRouter>);
}

describe('terms of service', () => {
  it('identifies the operator, contact, effective date and linked privacy notice', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeVisible();
    expect(screen.getByText(/Kitakod Ventures \(SSM 202203226187/)).toBeVisible();
    expect(screen.getByText('Effective: 16 September 2026')).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'hello@kitakodventures.com' })[0]).toHaveAttribute('href', 'mailto:hello@kitakodventures.com');
    expect(screen.getByRole('link', { name: 'privacy notice' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(document.querySelectorAll('article > section')).toHaveLength(10);
  });

  it('explains actual approval limits and preserves mandatory rights rather than promising immunity', () => {
    mount();
    expect(screen.getByText(/Current Google Calendar event creation/)).toHaveTextContent(/separate owner approval/);
    expect(screen.getByText(/Not every browser interaction/)).toHaveTextContent(/closing the window does not hand it back/);
    expect(screen.getByText(/AI outputs may be inaccurate/)).toHaveTextContent(/not an emergency service/);
    expect(screen.getByText(/We remain responsible where applicable law/)).toHaveTextContent(/mandatory consumer or data-protection rights/);
    expect(screen.getByText(/We will not treat a chat instruction/)).toBeVisible();
  });

  it('offers all ten sections in Bahasa Malaysia and can switch back to English', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Terma perkhidmatan' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '10. Perubahan, undang-undang dan hubungan' })).toBeVisible();
    expect(screen.getByText(/Bukan setiap interaksi pelayar/)).toBeVisible();
    expect(screen.getByText(/Kami kekal bertanggungjawab/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'notis privasi' })).toHaveAttribute('href', '/privacy');
    expect(document.querySelectorAll('article > section')).toHaveLength(10);
    expect(document.querySelector('main')).toHaveAttribute('lang', 'ms');
    expect(document.documentElement).toHaveAttribute('lang', 'ms');
    expect(screen.getByRole('button', { name: 'Bahasa Malaysia' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeVisible();
    expect(document.querySelector('main')).toHaveAttribute('lang', 'en');
  });
});
