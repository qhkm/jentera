/* What the service worker shows for a push, and where a tap lands. Kept
   out of the worker file so it can be tested in jsdom: the worker itself
   only runs under a ServiceWorkerGlobalScope. */

export interface PushMessage {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  tag?: unknown;
}

/** Only a path inside this origin is ever opened from a notification. */
function safePath(url: unknown): string {
  return typeof url === 'string' && /^\/(?!\/)/.test(url) ? url : '/app';
}

export function notificationFromPush(data: unknown): {
  title: string;
  options: NotificationOptions & { data: { url: string } };
} {
  const message: PushMessage = data && typeof data === 'object' ? (data as PushMessage) : {};
  const title = typeof message.title === 'string' && message.title.trim() ? message.title.slice(0, 160) : 'Jentera';
  const body = typeof message.body === 'string' ? message.body.slice(0, 500) : '';
  return {
    title,
    options: {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      ...(typeof message.tag === 'string' && message.tag ? { tag: message.tag } : {}),
      data: { url: safePath(message.url) },
    },
  };
}

export function targetUrl(data: { url?: unknown } | undefined, origin: string): string {
  return new URL(safePath(data?.url), origin).href;
}
