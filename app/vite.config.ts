import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/pwa/manifest.ts';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /* Installable app. The worker precaches the hashed bundle so the shell
       boots offline, answers navigations from the network first (the route
       shells change on every deploy; a cached one must never win while the
       network is there), and falls back to offline.html when it is not.
       Nothing from api.jentera.ai is ever cached: it is another origin, and
       no route here matches it. Updates wait for the owner (`prompt`), so a
       deploy cannot reload a page mid-reply. */
    VitePWA({
      /* src/sw.ts is the worker: the caching described above plus the
         push and notification-click handlers, which a generated worker
         cannot carry. Its precache list is injected at build time. */
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png', 'offline.html'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,woff2,svg,png}', 'offline.html'],
        globIgnores: ['**/social/**', 'sw.js', 'workbox-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    // Fonts are the bulk of the payload; keep them as separate cacheable files
    // rather than inlining into the CSS.
    assetsInlineLimit: 0,
  },
});
