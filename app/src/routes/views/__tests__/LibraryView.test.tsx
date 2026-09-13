import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionsState } from '@/hooks/useConnections';
import LibraryView from '../LibraryView';

const connections: ConnectionsState = { rows: [], mode: 'real', real: true, error: null, retry: vi.fn(), setRows: vi.fn() };
function mount(tab = 'playbooks', state = connections, canSchedule = true) {
  const onUse = vi.fn();
  render(<MemoryRouter initialEntries={[`/app?view=library&tab=${tab}`]}><LibraryView canSchedule={canSchedule} onUse={onUse} connections={state} /></MemoryRouter>);
  return { user: userEvent.setup(), onUse };
}

describe('Library', () => {
  it('navigates between independent sections and shows bundled skill instructions', async () => {
    const { user, onUse } = mount();
    await user.click(screen.getByRole('link', { name: 'Skills' }));
    expect(screen.getByRole('link', { name: 'Skills' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Web research' })).toBeInTheDocument();
    await user.click(screen.getAllByText('View instructions')[1]);
    expect(screen.getAllByText(/Research the topic specified below/)[0]).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Connectors' }));
    expect(screen.getByText('Not connected')).toBeVisible();
    expect(screen.getByRole('link', { name: /Manage Telegram/ })).toHaveAttribute('href', '/app?view=business&tab=connections');
    expect(screen.getAllByText('Not available yet')).toHaveLength(3);
    expect(onUse).not.toHaveBeenCalled();
  });
  it('does not present failed status reads as disconnected', () => {
    mount('connectors', { ...connections, mode: 'error', real: false, rows: null, error: new Error('offline') });
    expect(screen.getByText('Connection status unavailable')).toBeVisible();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  });
  it('hands a reviewed playbook draft to scheduling, without saving', async () => {
    const { user, onUse } = mount();
    await user.click(screen.getByRole('button', { name: /Daily business brief/ }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Choose schedule' }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ name: 'Daily business brief', task: { kind: 'business_summary' } }));
  });
  it('blocks scheduling when routines are unavailable', async () => {
    const { user, onUse } = mount('playbooks', connections, false);
    await user.click(screen.getByRole('button', { name: /Daily business brief/ }));
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Choose schedule' })).toBeDisabled();
    expect(onUse).not.toHaveBeenCalled();
  });
});
