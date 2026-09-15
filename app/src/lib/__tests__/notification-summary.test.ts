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

  it('leaves ordinary completed notifications unchanged', () => {
    expect(notificationSummary(notification('Stock check — completed', 'Everything is ready.'))).toBeNull();
  });
});
