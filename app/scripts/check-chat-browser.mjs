// Launch smoke with fictional API/browser state; never use a production session.
// VITE_API_URL=http://127.0.0.1:5183 pnpm dev --host 127.0.0.1 --port 5183
// CHROME_CHANNEL=chrome node scripts/check-chat-browser.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.CHECK_ORIGIN ?? 'http://127.0.0.1:5183';
const snapshot = {
  onboarded: true, setupDone: true, bizType: 'restaurant', bizName: 'Launch smoke · Demo',
  bizLoc: 'Shah Alam', channels: [], conns: [], country: 'MY', lang: 'en', theme: 'dark',
  approvals: [], permissions: {}, workDone: {}, learn: {}, specialists: [], facts: [], canManageKnowledge: true,
};
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });
try {
  const sample = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await sample.setContent('<main style="font:24px sans-serif;padding:60px">Synthetic business sign-in screen</main>');
  const image = (await sample.screenshot({ type: 'jpeg' })).toString('base64');
  await sample.close();
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const errors = [];
    const commands = [];
    let paused = false;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      let body;
      if (url.pathname === '/api/browser') {
        const command = request.method() === 'POST' ? request.postDataJSON() : undefined;
        if (command) commands.push(command);
        if (command?.action === 'claim') paused = true;
        if (command?.action === 'release') paused = false;
        body = { enabled: true, paused, controlled: paused, ok: true,
          ...(command?.action === 'frame' ? { image, width: 1280, height: 800,
            tabs: [{ index: 0, origin: 'https://example.com', selected: true }] } : {}) };
      } else if (url.pathname === '/api/runtime/wake') body = { ok: true };
      else if (url.pathname === '/api/events') return route.fulfill({ status: 204 });
      else if (request.method() !== 'GET') {
        errors.push('Unexpected write: ' + url.pathname);
        return route.fulfill({ status: 400, contentType: 'application/json', body: '{"err":"unexpected write"}' });
      } else if (url.pathname === '/api/me') body = { ok: true, userId: 'demo-owner', detailLevel: 'simple', features: {} };
      else if (url.pathname === '/api/state') body = { ok: true, snapshot };
      else if (url.pathname === '/api/runs/activity') body = { ok: true, work: [], counters: { completed: 0, needsApproval: 0, minutesSaved: 0, failed: 0 } };
      else if (url.pathname === '/api/connections') body = { ok: true, connections: [] };
      else if (url.pathname === '/api/notifications') body = { ok: true, items: [], notifications: [], unread: 0, nextCursor: null };
      else if (url.pathname === '/api/workspaces') body = { ok: true, workspaces: [], canManage: true };
      else if (url.pathname === '/api/runtime') body = { ok: true, runtime: { status: 'ready' }, usage: {} };
      else if (url.pathname === '/api/agent/memory') body = { ok: true, available: true, profiles: [] };
      else {
        errors.push('Missing fixture: ' + url.pathname);
        return route.fulfill({ status: 404 });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/app?view=chat');
    const draft = 'Continue after I sign in';
    const composer = page.locator('.ask-writing-pad textarea');
    await composer.fill(draft);
    await page.getByRole('button', { name: 'Open business browser', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(node => node.closest('form') === null), true);
    await dialog.getByRole('button', { name: 'Take control', exact: true }).click();
    await page.getByText('Jentera is paused', { exact: true }).waitFor();
    await dialog.getByLabel('Website address').fill('https://example.com');
    await dialog.getByRole('button', { name: 'Go', exact: true }).click();
    await dialog.getByLabel('Text or password for the selected field').fill('synthetic-secret');
    await dialog.getByRole('button', { name: 'Type into browser', exact: true }).click();
    assert.equal(await dialog.getByLabel('Text or password for the selected field').inputValue(), '');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('synthetic-secret')), false);
    if (process.env.CHECK_OUTPUT_DIR) await page.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/browser-${width}.png` });
    await dialog.getByRole('button', { name: 'Close browser view', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Open Business Browser', exact: true }).click();
    await dialog.getByRole('button', { name: 'Hand back to Jentera', exact: true }).click();
    await page.getByText('Jentera is paused', { exact: true }).waitFor({ state: 'hidden' });
    await dialog.getByRole('button', { name: 'Close browser view', exact: true }).click();
    assert.equal(await composer.inputValue(), draft);
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(new Set(commands.map(command => command.controlId)).size, 1);
    assert.equal(commands.filter(command => command.action === 'release').length, 1);
    if (process.env.CHECK_OUTPUT_DIR) await page.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/chat-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: inline handoff, explicit release, no Chat submit, secret-free storage, no overflow`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, serviceWorkers: 'block' });
  const errors = [];
  await context.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname === '/api/me') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"err":"not signed in"}' });
    }
    if (new URL(route.request().url()).pathname === '/api/events') return route.fulfill({ status: 204 });
    errors.push('Unexpected anonymous API request: ' + route.request().url());
    return route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/', '/onboard', '/setup', '/app']) {
    await page.goto(origin + path);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('body').innerText().then(text => text.trim().length > 0), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS anonymous navigation ' + path);
  }
  assert.deepEqual(errors, []);
  await context.close();
} finally { await browser.close(); }
