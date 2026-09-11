import type { ManifestOptions } from 'vite-plugin-pwa';

/** The installable identity of Jentera. One object, read by the Vite build
    (which writes `/manifest.webmanifest`) and by the tests, so what a phone
    installs and what the suite checks cannot drift apart. Colours are the
    dark workspace tokens: the splash screen is painted before any CSS loads. */
export const manifest: Partial<ManifestOptions> = {
  id: '/app',
  name: 'Jentera',
  short_name: 'Jentera',
  description: 'Your AI staff for a Malaysian small business: chat, tasks, routines and the record of what was done.',
  start_url: '/app',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#1f1f1f',
  theme_color: '#1f1f1f',
  lang: 'en',
  dir: 'ltr',
  categories: ['business', 'productivity'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Chat with Jentera', short_name: 'Chat', url: '/app?view=chat', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'Dashboard', short_name: 'Dashboard', url: '/app', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
  ],
};
