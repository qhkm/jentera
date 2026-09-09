import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Deterministic typography/vector artwork using the app's existing mark and
// fonts. No external images, screenshot of business data, or build-time network.
const files = {
  '/': [new URL('./social-card.html', import.meta.url), 'text/html'],
  '/mark.svg': [new URL('../public/favicon.svg', import.meta.url), 'image/svg+xml'],
  '/sans.woff2': [new URL('../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2', import.meta.url), 'font/woff2'],
  '/pixel.woff2': [new URL('../node_modules/geist/dist/fonts/geist-pixel/GeistPixel-Square.woff2', import.meta.url), 'font/woff2'],
};
const output = new URL('../public/social/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.SOCIAL_CHROME_CHANNEL ? { channel: process.env.SOCIAL_CHROME_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const file = url.origin === 'https://social.jentera.test' ? files[url.pathname] : undefined;
    if (!file) throw new Error(`Unexpected artwork request: ${url}`);
    await route.fulfill({ body: await readFile(file[0]), contentType: file[1] });
  });
  await page.goto('https://social.jentera.test/');
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (!document.fonts.check('65px Pixel') || !document.fonts.check('20px Geist')) throw new Error('Artwork fonts did not load');
  });
  await page.screenshot({ path: fileURLToPath(new URL('jentera-v1.png', output)), type: 'png' });
  console.log('Rendered public/social/jentera-v1.png (1200 × 630). Review it before committing.');
} finally { await browser.close(); }
