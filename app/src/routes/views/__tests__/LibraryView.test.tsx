import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionsState } from '@/hooks/useConnections';
import LibraryView from '../LibraryView';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { I18nProvider } from '@/i18n/I18nProvider';

const connections: ConnectionsState = { rows: [], mode: 'real', real: true, error: null, retry: vi.fn(), setRows: vi.fn() };
async function mount(tab = 'playbooks', state = connections, canSchedule = true, repo = new LocalRepository()) {
  const onUse = vi.fn();
  render(<MemoryRouter initialEntries={[`/app?view=library&tab=${tab}`]}><RepositoryProvider repository={repo}><I18nProvider><LibraryView canSchedule={canSchedule} onUse={onUse} connections={state} /></I18nProvider></RepositoryProvider></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Library' });
  return { user: userEvent.setup(), onUse };
}

describe('Library', () => {
  it('navigates between independent sections and shows bundled skill instructions', async () => {
    const { user, onUse } = await mount();
    await user.click(screen.getByRole('link', { name: 'Skills' }));
    expect(screen.getByRole('link', { name: 'Skills' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Web research' })).toBeInTheDocument();
    await user.click(screen.getAllByText('View instructions')[1]);
    expect(screen.getAllByText(/Research the topic specified below/)[0]).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Connectors' }));
    expect(screen.getAllByText('Not connected')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeEnabled();
    expect(screen.getAllByText('Not available yet').length).toBeGreaterThan(3);
    expect(onUse).not.toHaveBeenCalled();
  });
  it('does not present failed status reads as disconnected', async () => {
    await mount('connectors', { ...connections, mode: 'error', real: false, rows: null, error: new Error('offline') });
    expect(screen.getByText(/Connection status unavailable/)).toBeVisible();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeDisabled();
  });
  it('opens Telegram setup inline without connecting until the user submits', async () => {
    const repo = new LocalRepository();
    const connect = vi.spyOn(repo, 'connectTelegram');
    const { user } = await mount('connectors', connections, true, repo);
    await user.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(screen.getByLabelText('Your bot token')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(connect).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close Telegram' }));
    await user.type(screen.getByRole('searchbox'), 'WhatsApp');
    expect(screen.getByRole('heading', { name: 'WhatsApp' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Connect WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Telegram' })).not.toBeInTheDocument();
  });
  it('lists server-supported token connectors with their direct setup', async () => {
    const repo = new LocalRepository();
    vi.spyOn(repo, 'tokenConnectors').mockResolvedValue([{ connector: 'github', label: 'GitHub' }]);
    const { user } = await mount('connectors', connections, true, repo);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('combobox')).toHaveValue('github');
  });
  it('hands a reviewed playbook draft to scheduling, without saving', async () => {
    const { user, onUse } = await mount();
    await user.click(screen.getByRole('button', { name: /Daily business brief/ }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Choose schedule' }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ name: 'Daily business brief', task: { kind: 'business_summary' } }));
  });
  it('blocks scheduling when routines are unavailable', async () => {
    const { user, onUse } = await mount('playbooks', connections, false);
    await user.click(screen.getByRole('button', { name: /Daily business brief/ }));
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Choose schedule' })).toBeDisabled();
    expect(onUse).not.toHaveBeenCalled();
  });
});
