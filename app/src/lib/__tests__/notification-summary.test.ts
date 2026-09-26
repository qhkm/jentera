import { describe, expect, it } from 'vitest';
import type { AppNotification } from '@/lib/notifications';
import { notificationSummary } from '@/lib/notification-summary';

const notification = (title: string, body: string): AppNotification => ({
  id: 'notification-1',
  kind: 'routine_completed',
  title,
  body,
  createdAt: '2026-09-15T00:00:00.000Z',
  readAt: null,
  runId: 'run-1',
  routineId: 'routine-1',
  occurrenceId: 'occurrence-1',
  url: null,
});

describe('notificationSummary', () => {
  it('extracts counts from existing long daily summaries', () => {
    const item = notification(
      'Canary: daily summary — completed',
      'Daily summary for the 24 hours to 15 Sept 2026, 08:00 (Asia/Kuala_Lumpur). 19 pieces of work recorded: 18 completed, 1 failed. 0 minutes saved. - raw task output',
    );

    expect(notificationSummary(item)).toEqual({
      period: 'daily', total: 19, completed: 18, failed: 1, minutes: 0,
    });
  });

  it('extracts counts from compact Malay weekly summaries', () => {
    const item = notification(
      'Ringkasan mingguan',
      '26 kerja direkodkan: 22 selesai, 4 gagal. 45 minit dijimatkan.',
    );

    expect(notificationSummary(item)).toEqual({
      period: 'weekly', total: 26, completed: 22, failed: 4, minutes: 45,
    });
  });

  it('reads summaries that count cancelled and other work, in both languages', () => {
    expect(notificationSummary(notification(
      'Daily summary',
      '3 pieces of work recorded: 1 completed, 0 failed, 1 cancelled, 1 other. 3 minutes saved.',
    ))).toEqual({ period: 'daily', total: 3, completed: 1, failed: 0, minutes: 3 });
    expect(notificationSummary(notification(
      'Ringkasan harian',
      '2 kerja direkodkan: 1 selesai, 0 gagal, 1 dibatalkan. 0 minit dijimatkan.',
    ))).toEqual({ period: 'daily', total: 2, completed: 1, failed: 0, minutes: 0 });
  });

  it('leaves ordinary completed notifications unchanged', () => {
    expect(notificationSummary(notification('Stock check — completed', 'Everything is ready.'))).toBeNull();
  });
});
