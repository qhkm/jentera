import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import NotificationsView from '@/routes/views/NotificationsView';

describe('notification inbox rows', () => {
  it('separates readable message copy from its date and action', async () => {
    const state = {
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'work_needs_you' as const,
        title: 'Supplier confirmation needed',
        body: 'Review the proposed supplier details before Jentera continues with the order.',
        runId: '22222222-2222-4222-8222-222222222222',
        routineId: null,
        occurrenceId: null,
        readAt: null,
        createdAt: '2026-09-21T04:30:00.000Z',
      }],
      unread: 1,
      nextCursor: null,
      loading: false,
      loadingMore: false,
      error: null,
      refresh: vi.fn(async () => {}),
      markRead: vi.fn(async () => {}),
      markAll: vi.fn(async () => {}),
      loadMore: vi.fn(async () => {}),
    };
    render(<RepositoryProvider repository={new LocalRepository()}><I18nProvider><NotificationsView state={state} onOpenTask={vi.fn()} onOpenRoutine={vi.fn()} onOpenReview={vi.fn()} /></I18nProvider></RepositoryProvider>);
    const card = (await screen.findByText('Supplier confirmation needed')).closest('button');
    expect(card).toHaveClass('notification-card');
    expect(card?.querySelector('.notification-copy')).toHaveTextContent('Review the proposed supplier details');
    expect(card?.querySelector('.notification-side time')).toHaveAttribute('datetime', '2026-09-21T04:30:00.000Z');
  });

  it('opens a finished task\'s result, not the review queue', async () => {
    const onOpenTask = vi.fn();
    const onOpenReview = vi.fn();
    const state = {
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'work_finished' as const,
        title: 'Chase the late invoices — done',
        body: 'Open it to see the result.',
        runId: '22222222-2222-4222-8222-222222222222',
        routineId: null,
        occurrenceId: null,
        readAt: null,
        createdAt: '2026-09-24T02:00:00.000Z',
      }],
      unread: 1,
      nextCursor: null,
      loading: false,
      loadingMore: false,
      error: null,
      refresh: vi.fn(async () => {}),
      markRead: vi.fn(async () => {}),
      markAll: vi.fn(async () => {}),
      loadMore: vi.fn(async () => {}),
    };
    render(<RepositoryProvider repository={new LocalRepository()}><I18nProvider><NotificationsView state={state} onOpenTask={onOpenTask} onOpenRoutine={vi.fn()} onOpenReview={onOpenReview} /></I18nProvider></RepositoryProvider>);
    (await screen.findByText('Chase the late invoices — done')).closest('button')?.click();
    await vi.waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'Chase the late invoices — done'));
    expect(onOpenReview).not.toHaveBeenCalled();
  });
});
