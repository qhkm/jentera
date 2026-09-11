/// <reference lib="webworker" />
/* The installed app's service worker. Built by vite-plugin-pwa in
   injectManifest mode, which fills __WB_MANIFEST with the hashed bundle.
   Caching mirrors what the generated worker did before push arrived:
   precache the shell, navigations network-first so a deploy is never
   hidden behind a cached page, offline.html when nothing is reachable.
   Nothing from api.jentera.ai is cached; no route here matches it. */
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, precacheAndRoute, PrecacheFallbackPlugin } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { notificationFromPush, targetUrl } from './pwa/sw-push';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
clientsClaim();

/* `prompt` updates: the page asks the waiting worker to take over only
   when the owner presses Reload. */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

registerRoute(
  ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'jentera-pages',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 7 * 24 * 60 * 60 }),
      new PrecacheFallbackPlugin({ fallbackURL: '/offline.html' }),
    ],
  }),
);

/* Web push. The worker decrypts the payload the Worker encrypted to this
   browser's key and hands it to the OS as a notification; a push must
   always show one, so an unreadable payload still shows the brand. */
self.addEventListener('push', (event) => {
  let data: unknown = null;
  try {
    data = event.data?.json() ?? null;
  } catch {
    data = { body: event.data?.text() ?? '' };
  }
  const { title, options } = notificationFromPush(data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = targetUrl(event.notification.data as { url?: unknown } | undefined, self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(url);
      return;
    }
    await self.clients.openWindow(url);
  })());
});
