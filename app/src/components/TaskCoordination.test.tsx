import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRepository, RepositoryProvider } from '@/lib/repo';
import { I18nProvider } from '@/i18n/I18nProvider';
import { TaskCoordination } from './TaskCoordination';
import type { RunCoordination } from '@/lib/repo/types';

const initial: RunCoordination = { assignment: { role: 'Operations', kind: 'specialist' }, events: [] };
const mount = (read: (id: string) => Promise<RunCoordination>, live = false) => render(
  <RepositoryProvider repository={Object.assign(new LocalRepository(), { runCoordination: read })}>
    <I18nProvider><TaskCoordination runId="test-run" live={live} /></I18nProvider>
  </RepositoryProvider>);
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('recorded role activity', () => {
  it('distinguishes assignment from handoff and opens the disclosure', async () => {
    mount(async () => initial);
    const trigger = await screen.findByRole('button', { name: /Who’s working on this/ });
    expect(screen.queryByRole('region')).toBeNull();
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Assigned to Operations.')).toBeVisible();
    expect(screen.getByText(/Assignment alone is not a handoff/)).toBeVisible();
    expect(screen.queryByText('Specialist assistance requested')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
    await userEvent.click(trigger);
    await userEvent.click(document.body);
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('polls live work and stops on unmount without inventing destination names', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, events: [
      { id: 1, stage: 'requested', at: '2026-09-12T01:00:00Z' },
      { id: 2, stage: 'failed', at: '2026-09-12T01:01:00Z' },
    ] });
    const view = mount(read, true);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { screen.getByRole('button', { name: /Who’s working on this/ }).click(); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Specialist assistance requested')).toBeInTheDocument();
    expect(screen.getByText('Delegation reported an error')).toBeInTheDocument();
    expect(screen.queryByText(/Finance/)).toBeNull();
    view.unmount();
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('allows retry after a failed read and labels returned events without claiming success', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...initial, events: [
      { id: 1, stage: 'returned', at: '2026-09-12T01:01:00Z' },
    ] });
    mount(read);
    await userEvent.click(await screen.findByRole('button', { name: /Who’s working on this/ }));
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByText('Delegation returned to the lead role')).toBeInTheDocument());
    expect(screen.getByText(/not proof the task succeeded/)).toBeInTheDocument();
  });
});
