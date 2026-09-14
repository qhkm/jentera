import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBusinessBrowser } from '../src/business-browser.mjs';
import { serveBrowserPreview } from '../src/browser-preview-stream.mjs';

test('real browser streams changing JPEG frames and suppresses a login page over HTTP', {
  skip: !process.env.BROWSER_SMOKE, timeout: 20000,
}, async () => {
  const { chromium } = await import('../../app/node_modules/playwright/index.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'jentera-preview-smoke-'));
  let context;
  let reader;
  let server;
  let active = true;
  try {
    const browser = createBusinessBrowser({ stateFile: join(dir, 'state'), profileDir: dir }, { chromium: {
      connectOverCDP: async () => { throw new Error('isolated test'); },
      launchPersistentContext: async path => {
        context = await chromium.launchPersistentContext(path, { headless: true, channel: process.env.BROWSER_SMOKE_CHANNEL || undefined });
        await context.route('https://preview.test/**', route => route.fulfill({ contentType: 'text/html',
          body: route.request().url().endsWith('/login') ? '<input type="password">' : '<h1>First public page</h1>' }));
        return context;
      },
    } });
    await browser.ensure();
    const page = context.pages()[0];
    await page.goto('https://preview.test/docs');
    server = createServer((_req, res) => void serveBrowserPreview(res, browser, () => active));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}`);
    reader = response.body.getReader();
    let buffer = '';
    const decoder = new TextDecoder();
    async function next() {
      while (!buffer.includes('\n')) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        buffer += decoder.decode(value, { stream: true });
      }
      const end = buffer.indexOf('\n');
      const frame = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      return frame;
    }
    const first = await next();
    assert.equal(first.previewStatus, 'ready');
    assert.ok(Buffer.from(first.image, 'base64').length > 1000);
    await page.locator('h1').evaluate(el => { el.textContent = 'Changed public content'; });
    const second = await next();
    assert.equal(second.previewStatus, 'ready');
    assert.notEqual(second.image, first.image);
    await page.goto('https://preview.test/login');
    assert.deepEqual(await next(), { previewStatus: 'private' });
    active = false;
    assert.deepEqual(await next(), { previewStatus: 'inactive' });
  } finally {
    await reader?.cancel();
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    await context?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
