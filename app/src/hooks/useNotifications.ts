import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchNotifications,
  readAllNotifications,
  readNotification,
  type AppNotification,
} from '@/lib/notifications';

export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const page = await fetchNotifications();
      if (request.current !== current) return;
      setItems(page.notifications);
      setUnread(page.unread);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (reason) {
      if (request.current === current) setError(reason instanceof Error ? reason : new Error('Could not load notifications.'));
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => { window.clearInterval(timer); request.current += 1; };
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target || target.readAt) return;
    await readNotification(id);
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: now } : item));
    setUnread((value) => Math.max(0, value - 1));
  }, [items]);

  const markAll = useCallback(async () => {
    await readAllNotifications();
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => item.readAt ? item : { ...item, readAt: now }));
    setUnread(0);
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchNotifications(nextCursor);
      setItems((current) => [...current, ...page.notifications.filter((next) =>
        !current.some((item) => item.id === next.id))]);
      setUnread(page.unread);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error('Could not load notifications.'));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  return { items, unread, nextCursor, loading, loadingMore, error, refresh, markRead, markAll, loadMore };
}
