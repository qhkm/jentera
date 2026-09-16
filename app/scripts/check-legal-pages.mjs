import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.CHECK_ORIGIN ?? 'http://127.0.0.1:4175';
const output = process.env.CHECK_OUTPUT_DIR;
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined });
if (output) await mkdir(output, { recursive: true });

try {
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    let apiCalls = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // The signed-out fixture deliberately returns 401 for /api/me. Keep
      // every other network, application and hydration error visible.
      const anonymousAuthFailure = new URL(message.location().url || '/', origin).pathname === '/api/me'
        && message.text() === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)';
      if (message.type() === 'error' && !anonymousAuthFailure) errors.push(message.text());
    });
    // Anonymous fixtures only. No real account, provider or OAuth call.
    await context.route('**/api/**', async (route) => {
      apiCalls++;
      const auth = new URL(route.request().url()).pathname === '/api/me';
      await route.fulfill({ status: auth ? 401 : 200, contentType: 'application/json', body: JSON.stringify(auth ? { err: 'not signed in' } : {}) });
    });
    for (const path of ['/privacy', '/terms']) {
      apiCalls = 0;
      errors.length = 0;
      const response = await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, `${path} must be public`);
      const title = path === '/privacy' ? 'Privacy notice' : 'Terms of service';
      await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
      const html = await response.text();
      assert(html.includes(title), `${path} must render without JavaScript`);
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `https://jentera.ai${path}`);
      assert.equal(apiCalls, 0, `${path} must not require an API`);
      assert.equal(await page.locator('footer a[href="/privacy"]').count(), 1);
      assert.equal(await page.locator('footer a[href="/terms"]').count(), 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} English overflows`);
      if (output) await page.screenshot({ path: `${output}/${path.slice(1)}-${viewport.width}-en.png`, fullPage: true });
      await page.getByRole('button', { name: 'Bahasa Malaysia', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: path === '/privacy' ? 'Notis privasi' : 'Terma perkhidmatan', exact: true }).waitFor();
      assert.equal(await page.locator('main').getAttribute('lang'), 'ms');
      assert.equal(await page.locator('html').getAttribute('lang'), 'ms');
      assert.equal(await page.locator('article > section').count(), path === '/privacy' ? 14 : 10);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} Bahasa Malaysia overflows`);
      if (output) await page.screenshot({ path: `${output}/${path.slice(1)}-${viewport.width}-bm.png`, fullPage: true });
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
      assert.deepEqual(errors, [], `${path} console or hydration errors`);
      console.log(`${path}: ${viewport.width}px · public HTML · EN/BM · no API · no overflow/errors`);
    }
    for (const path of ['/', '/onboard', '/setup', '/app']) {
      errors.length = 0;
      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
      await page.locator('main').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} overflows`);
      assert.deepEqual(errors, [], `${path} console errors`);
      console.log(`${path}: ${viewport.width}px · anonymous navigation intact`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
