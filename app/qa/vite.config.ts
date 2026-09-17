import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  cacheDir: 'node_modules/.vite-desktop-qa',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  optimizeDeps: { entries: ['qa/desktop.html'] },
  server: { host: '127.0.0.1', port: 3982, strictPort: true, proxy: {
    '/api/browser/desktop': { target: 'http://127.0.0.1:3981', ws: true },
    '/api/browser': { target: 'http://127.0.0.1:3980' },
  } },
});
