import type { AppNotification } from '@/lib/notifications';

export interface NotificationSummary {
  period: 'daily' | 'weekly';
  total: number;
  completed: number;
  failed: number;
  minutes: number;
}

export function routineSummary(text: string): NotificationSummary | null {
  const period = /weekly summary|ringkasan mingguan/i.test(text)
    ? 'weekly'
    : /daily summary|ringkasan harian/i.test(text)
      ? 'daily'
      : null;
  if (!period) return null;
  const counts = text.match(
    /(\d+)\s+(?:pieces? of work recorded|work recorded|kerja direkodkan)\s*:\s*(\d+)\s+(?:completed|selesai)\s*,\s*(\d+)\s+(?:failed|gagal)(?:\s*,\s*\d+\s+(?:other|lain))?\.?\s*(\d+)\s+(?:minutes?|minit)\s+(?:saved|dijimatkan)/i,
  );
  if (!counts) return null;
  return {
    period,
    total: Number(counts[1]),
    completed: Number(counts[2]),
    failed: Number(counts[3]),
    minutes: Number(counts[4]),
  };
}

/** Read both current compact notifications and the older full-report format,
    so already stored summaries become scannable without a data migration. */
export function notificationSummary(item: AppNotification): NotificationSummary | null {
  if (item.kind !== 'routine_completed') return null;
  return routineSummary(`${item.title} ${item.body}`);
}
