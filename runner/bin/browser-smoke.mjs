import { chromium } from '/home/sprite/.hermes/hermes-agent/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<main data-smoke="ready">Jentera browser ready</main>');
  const result = await page.locator('main').getAttribute('data-smoke');
  if (result !== 'ready') throw new Error('browser DOM assertion failed');
  process.stdout.write(JSON.stringify({ ok: true, browser: 'chromium' }) + '\n');
} finally {
  await browser.close();
}
