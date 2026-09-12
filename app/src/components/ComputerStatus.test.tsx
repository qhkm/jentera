import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { LocalRepository, RepositoryProvider, type RuntimeOverview, type RuntimeSummary } from '@/lib/repo';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { computerStatus } from '@/lib/computer-status';
import { ComputerStatus } from './ComputerStatus';

const ready: RuntimeSummary = { status: 'ready', desiredRelease: 'v1', observedRelease: 'v1', lastReadyAt: '2026-09-12T00:00:00Z', lastError: null };
function mount(read: () => Promise<RuntimeOverview>, signedIn = true, onOpenChat = vi.fn()) {
  const repo = Object.assign(new LocalRepository(), { runtimeStatus: read });
  return render(<MemoryRouter><SignedInProvider value={signedIn}><RepositoryProvider repository={repo}>
    <I18nProvider><ComputerStatus onOpenChat={onOpenChat} onOpenKnowledge={vi.fn()} /></I18nProvider>
  </RepositoryProvider></SignedInProvider></MemoryRouter>);
}
afterEach(() => vi.useRealTimers());
describe('computer readiness', () => {
  it.each([
    [{ runtime: null }, 'missing'],
    [{ runtime: null, setupStatus: 'queued' }, 'settingUp'],
    [{ runtime: null, setupStatus: 'exhausted' }, 'attention'],
    [{ runtime: ready }, 'ready'],
    [{ runtime: { ...ready, lastReadyAt: null } }, 'settingUp'],
    [{ runtime: { ...ready, observedRelease: 'v0' } }, 'updating'],
    [{ runtime: { ...ready, status: 'cold' } }, 'asleep'],
    [{ runtime: { ...ready, status: 'busy' } }, 'busy'],
    [{ runtime: { ...ready, status: 'waking' } }, 'waking'],
    [{ runtime: { ...ready, status: 'error' } }, 'attention'],
    [{ runtime: { ...ready, status: 'deleting' } }, 'unavailable'],
  ] as [RuntimeOverview, string][])('maps server evidence %j to %s', (data, status) => {
    expect(computerStatus(data)).toBe(status);
  });
  it('shows owner setup action without creating compute on mount', async () => {
    mount(async () => ({ runtime: null, canManage: true }));
    expect(await screen.findByRole('link', { name: 'Set up' })).toHaveAttribute('href', '/setup');
  });
  it('keeps lifecycle actions out of a staff dashboard', async () => {
    mount(async () => ({ runtime: null, canManage: false }));
    expect(await screen.findByText('Ask your business owner to review setup.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Set up' })).toBeNull();
  });
  it('does not report a failed request as a missing computer and can recover', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ runtime: ready });
    const chat = vi.fn(); mount(read, true, chat);
    await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Ready for work')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Give Jentera a job' }));
    expect(chat).toHaveBeenCalledOnce();
  });
  it('transitions from queued setup to ready automatically, then cleans up polling', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce({ runtime: null, setupStatus: 'queued' }).mockResolvedValue({ runtime: ready });
    const view = mount(read);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Setting up…')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('Ready for work')).toBeInTheDocument();
    view.unmount();
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not invent a VM for anonymous demo users', () => {
    const read = vi.fn(); mount(read, false);
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).toBeNull();
  });
});
