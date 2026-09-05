// Playwright is a devDependency of the apps/desktop workspace and is NOT
// hoisted to the install root (v2026.9.7+ tree), so the historical
// root node_modules path no longer resolves. bootstrap-runtime.sh locates
// the real package entry and passes it here.
const pwEntry =
  process.env.PLAYWRIGHT_ENTRY ||
  '/home/sprite/.hermes/hermes-agent/apps/desktop/node_modules/playwright/index.mjs';
if (!pwEntry) {
  throw new Error('PLAYWRIGHT_ENTRY is not set; cannot locate playwright');
}
const { chromium } = await import(pwEntry);

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
