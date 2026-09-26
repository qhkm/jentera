import { useCallback, useContext, useMemo } from 'react';
import {
  QueryClient, QueryClientContext, useInfiniteQuery, useMutation, type InfiniteData,
} from '@tanstack/react-query';
import { keys } from '@/lib/query/keys';
import { useBusinessId } from '@/lib/query/scope';
import {
  fetchNotifications,
  readAllNotifications,
  readNotification,
  type AppNotification,
  type NotificationPage,
} from '@/lib/notifications';

/** How often the list is read again while the app is on screen. */
export const NOTIFICATIONS_POLL_MS = 60_000;

export interface NotificationsState {
  items: AppNotification[];
  unread: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  refresh(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAll(): Promise<void>;
  loadMore(): Promise<void>;
}

export type NotificationPages = InfiniteData<NotificationPage, string | null>;

/* Only the dev preview and tests render Dashboard without a signed-in cache
   (production's /app is behind RequireAuth). They get this client so the
   hooks below can be called, with the query disabled and nothing sent. */
const INERT = new QueryClient();

/** One notification read: its row, and every page's unread count, once. */
export function markOneRead(data: NotificationPages, id: string, at: string): NotificationPages {
  let found = false;
  const pages = data.pages.map((page) => ({
    ...page,
    notifications: page.notifications.map((item) => {
      if (item.id !== id || item.readAt) return item;
      found = true;
      return { ...item, readAt: at };
    }),
  }));
  if (!found) return data;
  return { ...data, pages: pages.map((page) => ({ ...page, unread: Math.max(0, page.unread - 1) })) };
}

/** Everything read. */
export function markEveryRead(data: NotificationPages, at: string): NotificationPages {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      unread: 0,
      notifications: page.notifications.map((item) => (item.readAt ? item : { ...item, readAt: at })),
    })),
  };
}

/** The page's one notifications query: the bell and the Alerts view read the
    same cache entry, so together they make one request. It is read again
    every 60 s while the app is on screen, never in the background. Marking
    read changes the cache first, puts it back if the server refuses, and
    then reads the list again to confirm. */
export function useNotifications(): NotificationsState {
  const scoped = useContext(QueryClientContext);
  const businessId = useBusinessId();
  const live = scoped !== undefined && businessId !== null;
  const client = scoped ?? INERT;
  const key = keys.notifications(businessId ?? 'none');

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchIntervalInBackground: false,
    enabled: live,
  }, client);

  const optimistic = (change: (data: NotificationPages) => NotificationPages) => async () => {
    await client.cancelQueries({ queryKey: key });
    const before = client.getQueryData<NotificationPages>(key);
    if (before) client.setQueryData<NotificationPages>(key, change(before));
    return { before };
  };
  const restore = (_error: Error, _variables: unknown, context: { before?: NotificationPages } | undefined) => {
    if (context?.before) client.setQueryData<NotificationPages>(key, context.before);
  };
  const confirm = () => { void client.invalidateQueries({ queryKey: key }); };

  const readOne = useMutation({
    mutationFn: (id: string) => readNotification(id),
    onMutate: (id: string) => optimistic((data) => markOneRead(data, id, new Date().toISOString()))(),
    onError: restore,
    onSettled: confirm,
  }, client);
  const readAll = useMutation({
    mutationFn: () => readAllNotifications(),
    onMutate: optimistic((data) => markEveryRead(data, new Date().toISOString())),
    onError: restore,
    onSettled: confirm,
  }, client);

  const pages = query.data?.pages;
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (pages ?? []).flatMap((page) => page.notifications).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [pages]);
  /* Pages are read in order, so the last one holds the newest count. */
  const last = pages?.[pages.length - 1];

  const { refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const refresh = useCallback(async () => {
    if (live) await refetch();
  }, [live, refetch]);
  const readOneAsync = readOne.mutateAsync;
  const markRead = useCallback(async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!live || !target || target.readAt) return;
    await readOneAsync(id);
  }, [live, items, readOneAsync]);
  const readAllAsync = readAll.mutateAsync;
  const markAll = useCallback(async () => {
    if (live) await readAllAsync();
  }, [live, readAllAsync]);
  const loadMore = useCallback(async () => {
    if (!live || !hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [live, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    items,
    unread: last?.unread ?? 0,
    nextCursor: last?.nextCursor ?? null,
    loading: live && query.isFetching && !isFetchingNextPage,
    loadingMore: isFetchingNextPage,
    error: query.error,
    refresh,
    markRead,
    markAll,
    loadMore,
  };
}
