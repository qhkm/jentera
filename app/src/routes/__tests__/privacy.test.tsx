import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Privacy from '@/routes/Privacy';

function mount() {
  return render(<MemoryRouter><Privacy /></MemoryRouter>);
}

describe('privacy notice', () => {
  it('identifies the controller, data practices and a working privacy contact', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    expect(screen.getByText(/Kitakod Ventures \(SSM 202203226187/)).toBeVisible();
    expect(screen.getByText(/People’s Republic of China/)).toBeVisible();
    expect(screen.getByText(/do not sell personal data/)).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'hello@kitakodventures.com' })[0]).toHaveAttribute('href', 'mailto:hello@kitakodventures.com');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  });

  it('provides the complete notice in Bahasa Malaysia and marks the language', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Notis privasi' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '11. Hak anda' })).toBeVisible();
    expect(document.querySelector('main')).toHaveAttribute('lang', 'ms');
    expect(document.documentElement).toHaveAttribute('lang', 'ms');
  });
});
