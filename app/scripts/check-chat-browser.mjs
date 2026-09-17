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
  for (const { width, height, theme = 'dark' } of [
    { width: 390, height: 844 }, { width: 1440, height: 1000 },
    { width: 320, height: 640 }, { width: 844, height: 390 },
    { width: 1440, height: 1000, theme: 'light' },
    { width: 2048, height: 1080 }, { width: 1280, height: 720 },
    { width: 1024, height: 500 }, { width: 960, height: 800 },
    { width: 961, height: 600 },
  ]) {
    if (process.env.CHECK_WIDTH && width !== Number(process.env.CHECK_WIDTH)) continue;
    const suffix = `${width}${theme === 'light' ? '-light' : ''}`;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const errors = [];
    const commands = [];
    let paused = false;
    let oauthStarts = 0;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      let body;
      if (url.pathname === '/api/connections/google-calendar/start') {
        assert.equal(request.method(), 'GET');
        oauthStarts++;
        // Simulate a denied grant, never call Google or claim real login success.
        return route.fulfill({ status: 302, headers: {
          location: origin + '/app?view=business&tab=connections&calendar=failed',
        } });
      } else if (url.pathname === '/api/browser') {
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
      else if (url.pathname === '/api/access') body = { restricted: false, signedIn: true,
        access: { allowed: true, kind: 'paid', preview: null }, founderGroup: null, billing: { checkoutEnabled: true } };
      else if (url.pathname === '/api/billing/status') body = { ok: true, checkoutEnabled: true,
        activation: 'active', state: null, preview: null };
      else if (url.pathname === '/api/state') body = { ok: true, snapshot: { ...snapshot, theme } };
      else if (url.pathname === '/api/runs/activity') body = { ok: true, work: [], counters: { completed: 0, needsApproval: 0, minutesSaved: 0, failed: 0 } };
      else if (url.pathname === '/api/connections') body = { ok: true, connections: [] };
      else if (url.pathname === '/api/connections/token') body = { ok: true, connectors: [] };
      else if (url.pathname === '/api/notifications') body = { ok: true, items: [], notifications: [], unread: 0, nextCursor: null };
      else if (url.pathname === '/api/workspaces') body = { ok: true, workspaces: [], canManage: true };
      else if (url.pathname === '/api/runtime') body = { ok: true, runtime: { status: 'ready' }, usage: {} };
      else if (url.pathname === '/api/agent/memory') body = { ok: true, available: true, profiles: [] };
      else if (/^\/api\/runs\/[^/]+\/coordination$/.test(url.pathname)) body = { ok: true, assignment: null, events: [] };
      else {
        errors.push('Missing fixture: ' + url.pathname);
        return route.fulfill({ status: 404 });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const now = Date.now();
      localStorage.setItem('jentera-ask-sessions-v1:demo-owner', JSON.stringify([{
        id: '11111111-1111-4111-8111-111111111112', title: 'Browser sign-in check', createdAt: now, updatedAt: now,
        messages: [
          { from: 'you', text: 'Check whether my business browser is signed in. Don’t change anything.' },
          { from: 'ai', state: 'done', runId: '11111111-1111-4111-8111-111111111111',
            text: 'The website needs sign-in. Nothing was changed.\n```jentera-browser\n{"reason":"sign_in"}\n```' },
        ],
      }, {
        id: '11111111-1111-4111-8111-111111111113', title: 'Calendar connection check', createdAt: now, updatedAt: now,
        messages: [
          { from: 'you', text: 'Check my schedule. Do not add an event.' },
          { from: 'ai', state: 'done', runId: '11111111-1111-4111-8111-111111111114',
            text: 'Calendar needs a connection. No event was created.\n```jentera-connect\n{"connector":"google_calendar"}\n```' },
        ],
      }]));
    });
    await page.goto(origin + '/app?view=chat');
    const draft = 'Continue after I sign in';
    const composer = page.locator('.ask-writing-pad textarea');
    await composer.fill(draft);
    const handoff = page.getByRole('region', { name: 'Sign in to continue' });
    await handoff.waitFor();
    assert.equal(await handoff.getByRole('button', { name: 'Open business browser' }).evaluate(node => node.getBoundingClientRect().height >= 44), true);
    assert.equal(await page.locator('.ask-reply').innerText().then(text => text.includes('jentera-browser')), false);
    assert.equal(commands.length, 0);
    if (process.env.CHECK_OUTPUT_DIR) await page.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/handoff-${suffix}.png` });
    await handoff.getByRole('button', { name: 'Open business browser', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const checkBrowserLayout = async () => {
      const geometry = await dialog.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const header = node.querySelector('.business-browser-header').getBoundingClientRect();
        const footer = node.querySelector('.business-browser-footer').getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
          radius: getComputedStyle(node).borderRadius,
          headerVisible: header.top >= 0 && header.bottom <= innerHeight,
          footerVisible: footer.top >= 0 && footer.bottom <= innerHeight,
          noOverflow: node.scrollWidth <= node.clientWidth };
      });
      if (width > 960) {
        assert.deepEqual({ left: geometry.left, top: geometry.top, width: geometry.width,
          height: geometry.height, radius: geometry.radius },
        { left: 0, top: 0, width, height, radius: '0px' }, 'Desktop browser must fill the viewport without gaps');
      } else {
        assert.equal(geometry.width, width - 24, 'Keep the existing phone/tablet dialog gutters');
        assert.equal(geometry.radius, '20px');
      }
      assert.ok(geometry.headerVisible && geometry.footerVisible && geometry.noOverflow,
        'Close and hand-back controls must stay visible without horizontal overflow');
    };
    await checkBrowserLayout();
    assert.equal(await dialog.evaluate(node => node.closest('form') === null), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    if (process.env.CHECK_OUTPUT_DIR) await page.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/welcome-${suffix}.png` });
    await dialog.getByRole('button', { name: 'Take control', exact: true }).click();
    await page.getByText('Jentera is paused', { exact: true }).waitFor();
    await dialog.getByLabel('Website address').fill('https://example.com');
    await dialog.getByRole('button', { name: 'Go', exact: true }).click();
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await dialog.getByRole('group', { name: 'Browser view zoom' }).getByText('125%', { exact: true }).waitFor();
    const remote = dialog.locator('.business-browser-screen');
    await remote.waitFor();
    await remote.evaluate(node => {
      // Measure at the actual click, not before Playwright finishes scrolling
      // the zoomed screen into view and the browser settles layout.
      node.addEventListener('click', event => {
        const bounds = node.getBoundingClientRect();
        window.__jenteraSmokeTap = { width: bounds.width, height: bounds.height,
          x: event.clientX - bounds.left, y: event.clientY - bounds.top,
          styleWidth: node.style.width };
      }, { capture: true, once: true });
    });
    await remote.click({ position: { x: 100, y: 80 } });
    const screenSize = await page.evaluate(() => window.__jenteraSmokeTap);
    const click = commands.findLast(command => command.action === 'click');
    assert.equal(screenSize.styleWidth, '125%');
    assert.ok(Math.abs(screenSize.x - 100) <= 1 && Math.abs(screenSize.y - 80) <= 1);
    assert.ok(click && Math.abs(click.x - screenSize.x * 1280 / screenSize.width) < .001, JSON.stringify({ click, screenSize }));
    assert.ok(click && Math.abs(click.y - screenSize.y * 800 / screenSize.height) < .001, JSON.stringify({ click, screenSize }));
    await dialog.getByRole('button', { name: 'Fit view', exact: true }).click();
    await dialog.getByRole('group', { name: 'Browser view zoom' }).getByText('100%', { exact: true }).waitFor();
    await dialog.getByLabel('Text or password for the selected field').fill('synthetic-secret');
    await dialog.getByRole('button', { name: 'Type into browser', exact: true }).click();
    assert.equal(await dialog.getByLabel('Text or password for the selected field').inputValue(), '');
    assert.equal(await dialog.getByLabel('Text or password for the selected field').getAttribute('type'), 'password');
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('synthetic-secret')), false);
    assert.equal(await dialog.locator('.business-browser-footer').evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    }), true);
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await checkBrowserLayout();
    if (process.env.CHECK_OUTPUT_DIR) await page.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/browser-${suffix}.png` });
    await dialog.getByRole('button', { name: 'Close browser view', exact: true }).click();
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
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
    await page.locator('.ask-writing-pad').getByRole('button', { name: 'Open business browser', exact: true }).click();
    await dialog.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    if (process.env.CHECK_OUTPUT_DIR) await page.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/chat-${suffix}.png` });
    const explicitActions = commands.filter(command => command.action !== 'frame').length;
    if (!await page.getByRole('button', { name: 'Open chat: Calendar connection check', exact: true }).count()) {
      await page.getByRole('button', { name: 'Open your chats', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Open chat: Calendar connection check', exact: true }).click();
    const calendar = page.getByRole('region', { name: 'Connect your calendar' });
    await calendar.waitFor();
    const connect = calendar.getByRole('link', { name: 'Connect Google Calendar', exact: true });
    const authorize = new URL(await connect.getAttribute('href'));
    assert.equal(authorize.pathname, '/api/connections/google-calendar/start');
    assert.ok([origin, 'https://api.jentera.ai'].includes(authorize.origin));
    assert.equal(authorize.search + authorize.hash, '');
    assert.equal(await connect.getAttribute('target'), '_blank');
    assert.equal(await calendar.getByRole('button', { name: 'Copy setup link' }).evaluate(node => node.getBoundingClientRect().height >= 44), true);
    assert.equal(await connect.evaluate(node => node.getBoundingClientRect().height >= 44), true);
    assert.equal(await page.locator('.ask-reply').innerText().then(text => text.includes('jentera-connect')), false);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(oauthStarts, 0);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async text => { window.__jenteraCalendarCopy = text; } } }));
    await calendar.getByRole('button', { name: 'Copy setup link', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__jenteraCalendarCopy), 'https://jentera.ai/app?view=business&tab=connections&connector=google');
    assert.equal(oauthStarts, 0);
    assert.equal(commands.filter(command => command.action !== 'frame').length, explicitActions);
    await calendar.scrollIntoViewIfNeeded();
    if (process.env.CHECK_OUTPUT_DIR) await page.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/calendar-${suffix}.png` });
    const [setup] = await Promise.all([context.waitForEvent('page'), connect.click()]);
    setup.on('pageerror', error => errors.push(error.message));
    await setup.getByText('Google did not complete the connection. Please try again.', { exact: true }).waitFor();
    assert.equal(await setup.getByRole('link', { name: 'Connect Google Calendar →', exact: true }).evaluate(node => {
      const cards = [...document.querySelectorAll('[role="tabpanel"] .card')];
      return node.closest('.card') === cards[0];
    }), true);
    assert.equal(oauthStarts, 1);
    assert.equal(await setup.getByRole('link', { name: 'Connect Google Calendar →', exact: true }).count(), 1);
    assert.equal(await setup.getByText('Google Calendar connected.', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(commands.filter(command => command.action !== 'frame').length, explicitActions);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await setup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.CHECK_OUTPUT_DIR) await setup.screenshot({ path: `${process.env.CHECK_OUTPUT_DIR}/calendar-return-${suffix}.png` });
    await setup.close();
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}×${height} ${theme}: browser handoff, Calendar OAuth tab, public copy link, callback error visible, no auto-control/resume, secret-free storage, no overflow`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, serviceWorkers: 'block' });
  const errors = [];
  await context.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname === '/api/me') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"err":"not signed in"}' });
    }
    if (new URL(route.request().url()).pathname === '/api/events') return route.fulfill({ status: 204 });
    if (new URL(route.request().url()).pathname === '/api/access') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        restricted: false, signedIn: false, access: { allowed: true, kind: null, preview: null }, founderGroup: null,
      }) });
    }
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
