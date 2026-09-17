// Serve built assets locally; the browser sees a production host for the tag gate.
// Every network request is intercepted. Never sends fictional analytics or API writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const localOrigin = process.env.ANALYTICS_QA_ORIGIN ?? 'http://127.0.0.1:4187';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(localOrigin).hostname), 'QA source must be local');
const sourceOrigin = process.env.ANALYTICS_QA_LIVE_ORIGIN ?? localOrigin;
if (process.env.ANALYTICS_QA_LIVE_ORIGIN) {
  assert(['https://jentera.ai', 'https://jentera.aisar.ai'].includes(sourceOrigin), 'Live QA source must be an existing Jentera host');
}
const output = process.env.CHECK_OUTPUT_DIR;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });

try {
  for (const width of [320, 390, 1440]) {
    if (process.env.CHECK_WIDTH && width !== Number(process.env.CHECK_WIDTH)) continue;
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    let tagRequests = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
        tagRequests++;
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* QA stub: no analytics is sent. */' });
      }
      if (url.pathname.startsWith('/api/')) {
        const headers = { 'access-control-allow-origin': 'https://jentera.ai', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
        if (route.request().method() === 'OPTIONS' || url.pathname === '/api/events') return route.fulfill({ status: 204, headers });
        const body = url.pathname === '/api/billing/status'
          ? { ok: true, checkoutEnabled: true, mode: 'live', activation: 'none', state: null }
          : url.pathname === '/api/access'
            ? { restricted: true, signedIn: false, access: { allowed: false, kind: 'none' }, billing: { checkoutEnabled: true }, founderGroup: null }
            : { ok: false, code: 'UNAUTHENTICATED' };
        return route.fulfill({ status: url.pathname === '/api/me' ? 401 : 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.origin === 'https://jentera.ai') {
        const source = new URL(url.pathname + url.search, sourceOrigin);
        const response = await fetch(source);
        const headers = Object.fromEntries(response.headers);
        delete headers['content-encoding'];
        delete headers['content-length'];
        let body = Buffer.from(await response.arrayBuffer());
        if (process.env.ANALYTICS_QA_LIVE_ORIGIN && headers['content-type']?.includes('text/html')) {
          // Remove only Cloudflare's injected tracker. Never modify application assets.
          body = Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, script => {
            const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(script)?.[1];
            if (!src) return script;
            const target = new URL(src, sourceOrigin);
            return target.hostname === 'static.cloudflareinsights.com' && target.pathname.startsWith('/beacon.min.js') ? '' : script;
          }));
        }
        return route.fulfill({ status: response.status, headers, body });
      }
      // No Google collections, Turnstile, external pages or live provider calls.
      return route.fulfill({ status: 204 });
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text()); });
    const layout = async () => {
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px overflow`);
      assert.deepEqual(errors, [], `${width}px browser errors`);
    };
    await page.goto('https://jentera.ai/?gtm_debug=1789600000000');
    await page.getByRole('region', { name: 'Analytics choice' }).waitFor();
    assert.equal(tagRequests, 0, 'Tag must not load before consent');
    await layout();
    if (output) await page.screenshot({ path: `${output}/analytics-choice-${width}.png` });
    await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('jentera-google-tag'));
    const views = () => page.evaluate(() => (window.dataLayer ?? []).map(item => Array.from(item)).filter(item => item[0] === 'event' && item[1] === 'page_view'));
    assert.equal((await views()).length, 1);
    assert.equal((await views())[0][2].debug_mode, true, 'Debugger flag enables debug mode only after consent');
    assert.equal((await views())[0][2].page_location, 'https://jentera.ai/', 'Debug URL is sanitized');
    await page.getByRole('link', { name: 'Pricing', exact: true }).first().click();
    await page.waitForURL('**/pricing');
    await page.waitForFunction(() => (window.dataLayer ?? []).filter(item => item[0] === 'event').length === 2);
    assert.equal((await views()).length, 2, 'One pageview per public navigation');
    assert.equal(tagRequests, 1, 'Single tag bootstrap');
    await page.goto('https://jentera.ai/privacy');
    await page.getByRole('button', { name: 'Disable Google analytics' }).click();
    await page.waitForFunction(() => !document.getElementById('jentera-google-tag') && JSON.parse(localStorage.getItem('jentera-google-analytics-choice-v1'))?.choice === 'denied');
    assert.equal(await page.locator('#jentera-google-tag').count(), 0, 'Withdrawal unloads Google');
    await page.getByRole('button', { name: 'Enable Google analytics' }).click();
    await page.waitForFunction(() => document.getElementById('jentera-google-tag'));
    const tagsBeforePrivate = tagRequests;
    const privateNavigation = page.waitForEvent('request', request => request.isNavigationRequest() && new URL(request.url()).pathname === '/signin');
    // Narrow screens hide desktop nav; programmatic push tests the same router boundary.
    await page.evaluate(() => history.pushState(null, '', '/signin'));
    await privateNavigation;
    await page.waitForURL('**/signin');
    await page.waitForLoadState('networkidle');
    await page.getByRole('heading', { name: /account|welcome|sign/i }).first().waitFor().catch(async error => {
      console.log(JSON.stringify({ width, url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 1200) }));
      throw error;
    });
    assert.equal(await page.locator('#jentera-google-tag').count(), 0);
    assert.equal(tagRequests, tagsBeforePrivate, 'Private documents must not request Google tag');
    assert.equal(await page.evaluate(() => Boolean(window.dataLayer)), false, 'Private document has no Google queue');
    for (const path of ['/onboard', '/setup', '/app']) {
      await page.goto(`https://jentera.ai${path}`);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#jentera-google-tag').count(), 0, `${path} excludes Google`);
      await layout();
    }
    await page.goto('https://jentera.ai/?token=private-token');
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await page.locator('#jentera-google-tag').count(), 0, 'Sensitive query blocks Google');
    for (const query of ['?_dbg=1', '?gtm_debug=1789600000000', '?_dbg=1&utm_source=whatsapp']) {
      await page.goto(`https://jentera.ai/${query}`);
      await page.waitForFunction(() => document.getElementById('jentera-google-tag'));
      const event = (await views())[0][2];
      assert.equal(event.debug_mode, true);
      assert.equal(event.page_location, 'https://jentera.ai/');
      assert(!JSON.stringify(event).includes('1789600000000'), 'Debug timestamp is not sent');
      await layout();
    }
    const tagsAfterDebug = tagRequests;
    for (const path of ['/?_dbg=1&token=private-token', '/?gtm_debug=private@example.com', '/signin?_dbg=1', '/app?gtm_debug=1789600000000', '/subscribe?_dbg=1']) {
      await page.goto(`https://jentera.ai${path}`);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#jentera-google-tag').count(), 0, `${path} remains excluded`);
    }
    assert.equal(tagRequests, tagsAfterDebug, 'Debug flags do not bypass private or sensitive URL exclusion');
    await context.close();
    console.log(`PASS ${width}px: opt-in, public navigation, withdrawal, private boundary, core routes and validated debug URLs`);
  }
} finally { await browser.close(); }
