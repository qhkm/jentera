import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Connect from '@/routes/Connect';
import { getConnectorCatalogue } from '@/lib/connector-catalogue';

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
    expect(rows).toHaveLength(getConnectorCatalogue().length + 2);
    for (const row of rows) {
      const name = within(row).getByRole('heading').textContent;
      const available = name === 'Web workspace' || name === 'Telegram' || name === 'Bukku';
      expect(within(row).getByText(name === 'Google Calendar' ? 'Pilot' : available ? 'Available now' : 'Planned')).toBeInTheDocument();
    }
    expect(screen.getByText(/review every event before it is added/i)).toBeInTheDocument();
    expect(screen.getByText(/automatic booking is not available yet/i)).toBeInTheDocument();
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
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Google Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'WhatsApp' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Planned' }));
    expect(screen.getAllByRole('article')).toHaveLength(getConnectorCatalogue().length - 2);
    expect(screen.getByRole('button', { name: 'Planned' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Telegram' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Google Calendar' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('not available to connect yet');
    await user.click(screen.getByRole('button', { name: 'All connections' }));
    expect(screen.getAllByRole('article')).toHaveLength(getConnectorCatalogue().length + 2);
  });

  it('uses the shared Google Workspace catalogue without offering planned authorisation', async () => {
    const user = userEvent.setup();
    mount();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'google');
    expect(screen.getAllByRole('article')).toHaveLength(8);
    for (const row of screen.getAllByRole('article')) {
      expect(within(row).queryByRole('button')).toBeNull();
      // A catalogue card may link to that connector's own page and nothing
      // else. What this guards is an authorisation control on a connector
      // nobody can actually authorise.
      for (const link of within(row).queryAllByRole('link')) {
        expect(link.getAttribute('href')).toMatch(/^\/connect\/[a-z-]+$/);
      }
    }
    await user.type(screen.getByRole('searchbox'), 'Sheets');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Google Sheets' })).toBeVisible();
    await user.type(screen.getByRole('searchbox'), 'xxx');
    expect(screen.getByText(/No apps match/)).toBeVisible();
  });

});
