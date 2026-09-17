import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { LocalRepository, RepositoryProvider, type RuntimeOverview, type RuntimeSummary } from '@/lib/repo';
import { SignedInProvider } from '@/lib/repo/gate';
import { I18nProvider } from '@/i18n/I18nProvider';
import { computerStatus } from '@/lib/computer-status';
import { ComputerStatus } from './ComputerStatus';

const ready: RuntimeSummary = { status: 'ready', desiredRelease: 'v1', observedRelease: 'v1', lastReadyAt: '2026-09-12T00:00:00Z', lastError: null };
function mount(
  read: () => Promise<RuntimeOverview>,
  signedIn = true,
  onOpenChat = vi.fn(),
  mobileTarget?: HTMLElement,
  onOpenActivity = vi.fn(),
) {
  const repo = Object.assign(new LocalRepository(), { runtimeStatus: read });
  return render(<MemoryRouter><SignedInProvider value={signedIn}><RepositoryProvider repository={repo}>
    <I18nProvider><ComputerStatus mobileTarget={mobileTarget} onOpenChat={onOpenChat} onOpenKnowledge={vi.fn()} onOpenActivity={onOpenActivity} /></I18nProvider>
  </RepositoryProvider></SignedInProvider></MemoryRouter>);
}
afterEach(() => vi.useRealTimers());
describe('computer readiness', () => {
  it('shows a slim setup summary and reveals full guidance only on request', async () => {
    mount(async () => ({ runtime: null, setupStatus: 'queued', setupProgress: {
      stage: 'install', startedAt: '2026-09-17T08:00:00Z', updatedAt: new Date().toISOString(),
    } }));
    expect(await screen.findByText('Installing the workspace')).toBeVisible();
    expect(document.querySelector('.computer-status')).toHaveClass('computer-status-setup-strip');
    expect(screen.queryByText(/Rough estimate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/This updates automatically/)).not.toBeInTheDocument();
    const details = screen.getByRole('button', { name: 'Setup details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Setup details' });
    expect(within(panel).getByText(/Rough estimate/)).toBeVisible();
    expect(within(panel).getByText(/This updates automatically/)).toBeVisible();
    await userEvent.click(details);
    expect(screen.queryByRole('region', { name: 'Setup details' })).not.toBeInTheDocument();
  });
  it('shares one status poll with the header on every screen size and supports disclosure dismissal', async () => {
    const target = document.createElement('div'); document.body.append(target);
    const read = vi.fn().mockResolvedValue({ runtime: ready });
    const view = mount(read, true, vi.fn(), target);
    try {
      const user = userEvent.setup();
      const button = await screen.findByRole('button', { name: 'Jentera’s computer · Ready for work' });
      expect(view.container.querySelector('.computer-status')).toHaveClass('computer-status-header-hidden');
      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      await user.keyboard('{Escape}');
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute('aria-expanded', 'false');
      await user.click(button); await user.click(document.body);
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(read).toHaveBeenCalledOnce();
    } finally { view.unmount(); target.remove(); }
  });
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
  it('turns the header indicator into a useful link to the current task', async () => {
    const target = document.createElement('div'); document.body.append(target);
    const openActivity = vi.fn();
    const activeWork = {
      count: 2,
      runId: '11111111-1111-4111-8111-111111111111',
      objective: 'Prepare tomorrow’s supplier comparison',
      status: 'working' as const,
      startedAt: '2026-09-15T12:00:00.000Z',
    };
    const view = mount(async () => ({ runtime: ready, activeWork }), true, vi.fn(), target, openActivity);
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', {
        name: `Jentera · Working on · ${activeWork.objective}`,
      }));
      const popover = document.querySelector<HTMLElement>('.computer-status-popover')!;
      expect(within(popover).getByText(activeWork.objective)).toBeVisible();
      expect(within(popover).getByText('1 more in progress')).toBeVisible();
      await user.click(within(popover).getByRole('button', { name: 'View activity' }));
      expect(openActivity).toHaveBeenCalledWith(activeWork.runId, activeWork.objective);
    } finally { view.unmount(); target.remove(); }
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
