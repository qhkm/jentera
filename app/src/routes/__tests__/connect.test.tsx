import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Connect from '@/routes/Connect';

function mount() {
  return render(
    <MemoryRouter>
      <Connect />
    </MemoryRouter>,
  );
}

describe('Jentera connections', () => {
  it('distinguishes available owner channels from planned business connections', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your familiar tools.');
    const rows = screen.getAllByRole('article');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      const name = within(row).getByRole('heading').textContent;
      const available = name === 'Web workspace' || name === 'Telegram';
      expect(within(row).getByText(available ? 'Available now' : 'Planned')).toBeInTheDocument();
    }
    expect(
      screen.getByText(/MyInvois submission and e-invoicing are not currently available/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /tell us what you need/i })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
  });

  it('filters connections without making planned tools appear connectable', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Available now' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'WhatsApp' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Planned' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Planned' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Telegram' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('not available to connect yet');
    await user.click(screen.getByRole('button', { name: 'All connections' }));
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });

  it('restores the previous page title when leaving', () => {
    const previousTitle = document.title;
    const { unmount } = mount();
    expect(document.title).toContain('Jentera connections');
    unmount();
    expect(document.title).toBe(previousTitle);
  });
});
