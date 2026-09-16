// Fictional account fixtures only: never log in, call a provider, or use real credentials.
// VITE_API_URL=http://127.0.0.1:5183 pnpm dev --host 127.0.0.1 --port 5183
// CHROME_CHANNEL=chrome node scripts/check-connectors.mjs
// Optional CHECK_WIDTH=320 filters the responsive cases for a focused rerun.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.CHECK_ORIGIN ?? 'http://127.0.0.1:5183';
const output = process.env.CHECK_OUTPUT_DIR;
const runId = '11111111-1111-4111-8111-111111111111';
const sessionId = '33333333-3333-4333-8333-333333333333';
const setupMarker = '```jentera-connect\n{"connector":"google_calendar"}\n```';
const taskReplies = {
  connect: "Boss, I checked — Google Calendar needs authorization before I can read or write your calendar.\n\nUse Google’s permission flow in your normal browser, then return to Chat and ask me to continue.\n\n" + setupMarker + '\n\nConnecting does not add an event; each event still needs approval.',
  code: '**Report ready**\n\n- Review the `summary`\n- No changes were sent\n\n```python\nprint("' + 'long_code_'.repeat(30) + '")\n```\n\n| File | Status | Owner |\n| --- | --- | --- |\n| report.xlsx | Ready | Demo owner |',
  invalid: 'An example, not a request.\n```jentera-connect\n{"connector":"google_calendar","url":"https://example.com"}\n```',
  browser: 'Complete verification yourself.\n```jentera-browser\n{"reason":"mfa"}\n```',
};
const fixtureHeaders = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization' };
if (output) await mkdir(output, { recursive: true });
const snapshot = {
  onboarded: true, setupDone: true, bizType: 'restaurant', bizName: 'Kedai Kita · Demo',
  bizLoc: 'Shah Alam', channels: [], conns: [], country: 'MY', approvals: [], permissions: {},
  workDone: {}, learn: {}, specialists: [], facts: [], canManageKnowledge: true,
};
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });

try {
  for (const { width, height, lang = 'en', theme = 'dark' } of [
    { width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 1440, height: 1000 }, { width: 390, height: 844, lang: 'bm' },
    { width: 1440, height: 1000, theme: 'light' },
    { width: 1024, height: 600 }, { width: 1280, height: 600, lang: 'bm', theme: 'light' },
  ]) {
    if (process.env.CHECK_WIDTH && width !== Number(process.env.CHECK_WIDTH)) continue;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    const operations = [];
    let apiCalls = 0;
    let taskCase = 'connect';
    let paused = false;
    let taskStatus = 'needs_input';
    let rows = ['telegram', 'google'].map(connector => ({
      id: `fictional-${connector}`, connector, method: connector === 'telegram' ? 'bss' : 'oauth',
      status: 'connected', paired: true, displayName: connector === 'telegram' ? 'Kedai Kita bot' : 'Owner calendar',
      externalId: null, connectedAt: '', lastOkAt: null, lastError: null,
    }));
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`); });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      // Real app assets, fictional API only. Do not send QA analytics on live Pages.
      if (url.origin === origin && request.isNavigationRequest()) {
        const response = await route.fetch();
        const body = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, script => {
          const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(script)?.[1];
          if (!src) return script;
          const source = new URL(src, origin);
          return source.hostname === 'static.cloudflareinsights.com' && source.pathname.startsWith('/beacon.min.js') ? '' : script;
        });
        return route.fulfill({ response, body });
      }
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      apiCalls++;
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: fixtureHeaders });
      let body;
      if (url.pathname === '/api/events') return route.fulfill({ status: 204, headers: fixtureHeaders });
      if (/^\/api\/connections\/fictional-(telegram|google)$/.test(url.pathname) && request.method() === 'DELETE') {
        operations.push('disconnect:' + url.pathname.split('/').at(-1));
        rows = rows.filter(row => !url.pathname.endsWith(row.id));
        body = { ok: true };
      } else if (url.pathname === '/api/connections/fictional-telegram/health' && request.method() === 'GET') {
        operations.push('check');
        body = { ok: true, pointsHere: true, health: { url: '', pending: 0, lastError: null, lastErrorAt: null } };
      } else if (url.pathname === '/api/runtime/wake') body = { ok: true };
      // Existing Setup intentionally re-signals its idempotent provision task.
      // Fulfil it locally; the directory itself must never provision anything.
      else if (url.pathname === '/api/runtime/provision' && request.method() === 'POST' && new URL(page.url()).pathname === '/setup') body = { ok: true };
      else if (request.method() !== 'GET') {
        errors.push('Unexpected write: ' + request.method() + ' ' + url.pathname);
        return route.fulfill({ status: 400 });
      } else if (url.pathname === '/api/me') body = { ok: true, userId: 'fictional-owner', detailLevel: 'simple',
        features: width >= 1024 ? { routines: { apiVersion: 1 } } : {} };
      else if (url.pathname === '/api/access') body = { restricted: true, signedIn: true,
        access: { allowed: true, kind: 'paid', preview: null }, founderGroup: null, billing: { checkoutEnabled: true } };
      else if (url.pathname === '/api/billing/status') body = { ok: true, checkoutEnabled: true, mode: 'live',
        activation: 'active', state: null, preview: null,
        offer: { initialMonthlyAmount: 99, introductoryMonths: 3, renewalMonthlyAmount: 199, currency: 'MYR' } };
      else if (url.pathname === '/api/state') body = { ok: true, snapshot: { ...snapshot, lang, theme } };
      else if (url.pathname === '/api/connections') body = { ok: true, connections: rows };
      else if (url.pathname === '/api/connections/token') body = { ok: true, connectors: [] };
      else if (url.pathname === '/api/runs/activity') body = { ok: true, work: [], counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: rows.length } };
      else if (url.pathname === `/api/runs/${runId}` || url.pathname === `/api/runs/${runId}/review-summary`) body = {
        ok: true, runId, sessionId, status: 'completed', taskStatus, pending: false,
        objective: 'Check Google Calendar access', text: taskReplies[taskCase], summaryOnly: url.pathname.endsWith('/review-summary'),
      };
      else if (url.pathname === `/api/runs/${runId}/coordination`) body = { ok: true, runId, assignment: null, events: [] };
      else if (url.pathname === '/api/notifications') body = { ok: true, items: [], notifications: [], unread: 0, nextCursor: null };
      else if (url.pathname === '/api/workspaces') body = { ok: true, workspaces: [], canManage: true };
      else if (url.pathname === '/api/goals') body = { ok: true, available: true, canManage: true, goals: [] };
      else if (url.pathname === '/api/runtime') body = { ok: true, setupStatus: 'ready', runtime: { status: 'ready',
        desiredRelease: 'fictional-release', observedRelease: 'fictional-release', lastReadyAt: new Date().toISOString(), lastError: null }, usage: {} };
      else if (url.pathname === '/api/browser') body = { ok: true, enabled: true, paused, controlled: false };
      else if (url.pathname === '/api/agent/memory') body = { ok: true, available: true, profiles: [] };
      else { errors.push('Missing fixture: ' + url.pathname); return route.fulfill({ status: 404 }); }
      return route.fulfill({ status: 200, headers: fixtureHeaders, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const checkLayout = async () => {
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px overflow`);
      assert.deepEqual(errors, [], `${width}px console errors`);
    };
    const screenshot = async name => { if (output) await page.screenshot({ path: `${output}/${name}-${width}-${lang}-${theme}.png` }); };
    const labels = lang === 'bm' ? { category: 'Kategori', available: 'Tersedia', manage: 'Urus', disconnect: 'Putuskan sambungan', cancel: 'Batal', confirm: 'Sahkan pemutusan', check: 'Semak sambungan' }
      : { category: 'Category', available: 'Available', manage: 'Manage', disconnect: 'Disconnect', cancel: 'Cancel', confirm: 'Confirm disconnect', check: 'Check connection' };
    const recovery = lang === 'bm' ? { check: 'Semak persediaan', again: 'Semak semula', continue: 'Teruskan dalam Chat',
      missing: /Kalendar belum disambungkan/, paused: /Pelayar masih di bawah kawalan pemilik/,
      ready: /Jentera masih perlu mengesahkan akses Kalendar/, finished: /sudah ditandakan selesai/,
      browser: 'Buka pelayar bisnes', close: 'Tutup paparan pelayar', context: 'Teruskan permintaan saya sebelum ini:' }
      : { check: 'Check setup', again: 'Check again', continue: 'Continue in Chat', missing: /Calendar is not connected yet/,
        paused: /still under owner control/, ready: /must still verify live Calendar access/, finished: /already marked complete/,
        browser: 'Open business browser', close: 'Close browser view', context: 'Continue my earlier request:' };

    await page.goto(origin + '/connect');
    await page.getByRole('heading', { name: 'Google Sheets' }).waitFor();
    assert.equal(apiCalls, 0, 'Public catalogue must not fetch authenticated state');
    await page.getByRole('combobox', { name: 'Category' }).selectOption('google');
    const publicIds = await page.locator('.connector-card').evaluateAll(nodes => nodes.map(node => node.dataset.connector).sort());
    assert.equal(publicIds.length, 8);
    await checkLayout();
    await screenshot('public-grid');

    await page.goto(origin + '/app?view=business&tab=connections');
    await page.getByRole('button', { name: labels.check, exact: true }).waitFor();
    await page.getByRole('combobox', { name: labels.category }).selectOption('google');
    assert.deepEqual(await page.locator('.connector-card').evaluateAll(nodes => nodes.map(node => node.dataset.connector).sort()), publicIds);
    await page.getByRole('link', { name: `${labels.manage} Google Calendar`, exact: true }).click();
    assert(await page.locator('#connection-google').evaluate(node => node.getBoundingClientRect().top >= 0));
    await checkLayout();
    await screenshot('account-controls');

    await page.goto(origin + '/app?view=library&tab=connectors');
    await page.getByRole('combobox', { name: labels.category }).selectOption('google');
    assert.deepEqual(await page.locator('.connector-card').evaluateAll(nodes => nodes.map(node => node.dataset.connector).sort()), publicIds);
    assert.equal(await page.locator('.connector-card[data-connector="google-sheets"] button').count(), 0);
    const columns = await page.locator('.connector-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert(columns >= (width < 360 ? 1 : 2), 'Responsive grid columns');
    await page.getByRole('combobox', { name: labels.category }).scrollIntoViewIfNeeded();
    await screenshot('workspace-grid');
    await page.locator('.connector-card').first().scrollIntoViewIfNeeded();
    await screenshot('workspace-cards');
    await page.getByRole('button', { name: labels.available, exact: true }).click();
    assert.equal(await page.locator('.connector-card').count(), 1);
    await page.getByRole('button', { name: `${labels.manage} Google Calendar`, exact: true }).click();
    assert.equal(operations.length, 0, 'Opening setup cannot connect, check or disconnect');
    const setup = page.locator('#connector-google');
    // Font swaps can move wrapped controls after focus-driven scrolling.
    // Measure the finished layout rather than the transient fallback font.
    await page.evaluate(() => document.fonts.ready);
    await setup.getByRole('button', { name: labels.disconnect, exact: true }).click();
    assert(await setup.getByRole('button', { name: labels.cancel, exact: true }).evaluate(node => node === document.activeElement));
    const confirmationBounds = await page.locator('.connection-confirmation').evaluate(node => {
      const nav = document.querySelector('.dashboard-bottom-nav');
      const bottom = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
      const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      return { top, bottom, buttons: [...node.querySelectorAll('button')].map(button => {
        const bounds = button.getBoundingClientRect();
        return { text: button.innerText, top: bounds.top, bottom: bounds.bottom, height: bounds.height };
      }) };
    });
    assert(confirmationBounds.buttons.every(button => button.height >= 44 && button.top >= confirmationBounds.top && button.bottom <= confirmationBounds.bottom),
      'Both confirmation controls must be visible above the bottom menu: ' + JSON.stringify(confirmationBounds));
    // Wait for the finished colour transition rather than the first frame
    // immediately after the new confirmation buttons are mounted.
    await page.waitForFunction(() => {
      const node = document.querySelector('.connection-confirmation');
      if (!node) return false;
      const [cancel, confirm] = node.querySelectorAll('button');
      return cancel && confirm && getComputedStyle(cancel).color !== getComputedStyle(confirm).color;
    }, undefined, { timeout: 2000 });
    assert(await page.locator('.connection-confirmation').evaluate(node => {
      const [cancel, confirm] = node.querySelectorAll('button');
      return getComputedStyle(cancel).color !== getComputedStyle(confirm).color;
    }), 'Destructive confirmation must look distinct from Cancel');
    await checkLayout();
    await screenshot('disconnect-confirmation');
    await page.keyboard.press('Escape');
    assert(await setup.getByRole('button', { name: labels.disconnect, exact: true }).evaluate(node => node === document.activeElement));
    assert.equal(operations.length, 0);
    await setup.getByRole('button', { name: labels.disconnect, exact: true }).click();
    await setup.getByRole('button', { name: labels.confirm, exact: true }).click();
    await setup.getByRole('link', { name: 'Connect Google Calendar →' }).waitFor();
    assert.deepEqual(operations, ['disconnect:fictional-google']);

    await page.getByRole('combobox', { name: labels.category }).selectOption('all');
    await page.getByRole('button', { name: `${labels.manage} Telegram`, exact: true }).click();
    const telegram = page.locator('#connector-telegram');
    const check = telegram.getByRole('button', { name: labels.check, exact: true });
    assert(await check.evaluate(node => node.getBoundingClientRect().height >= 44));
    await check.click();
    await page.getByText(/Receiving normally/).waitFor();
    assert.deepEqual(operations, ['disconnect:fictional-google', 'check']);
    await checkLayout();

    await page.goto(origin + '/app?view=home');
    const sidebar = page.locator('.dashboard-sidebar');
    await sidebar.waitFor({ state: 'attached' });
    if (width >= 1024) {
      const headings = lang === 'bm' ? ['Ringkasan', 'Kerja', 'Ruang kerja'] : ['Overview', 'Work', 'Workspace'];
      assert.deepEqual(await sidebar.locator('.dashboard-nav-section h2').allTextContents(), headings);
      const workGroup = sidebar.getByRole('group', { name: headings[1], exact: true });
      const workNames = await workGroup.getByRole('button').allInnerTexts();
      assert.deepEqual(workNames, lang === 'bm' ? ['Aktiviti', 'Rutin', 'Matlamat'] : ['Activity', 'Routines', 'Goals']);
      assert.equal(await sidebar.locator('.dashboard-nav-item').count(), 8);
      await page.evaluate(() => document.fonts.ready);
      const density = await sidebar.evaluate(node => ({
        gap: parseFloat(getComputedStyle(node).gap),
        sectionGap: parseFloat(getComputedStyle(node.querySelector('.dashboard-sidebar-nav')).gap),
        profileHeight: node.querySelector('.dashboard-profile').getBoundingClientRect().height,
        rows: [...node.querySelectorAll('.dashboard-nav-item')].map(button => button.getBoundingClientRect().height),
      }));
      assert(density.gap <= 14 && density.sectionGap <= 10, 'Sidebar sections should remain compact');
      assert(density.profileHeight >= 44 && density.profileHeight <= 64, 'Business identity should be a compact, accessible row');
      assert.equal(await sidebar.getByRole('progressbar').count(), 0, 'Setup progress belongs outside the navigation');
      assert(density.rows.every(height => height >= 44 && height <= 45), 'Compact rows retain 44px accessible targets');
      await screenshot('sidebar-sections');
      const last = sidebar.locator('.dashboard-nav-item').last();
      await last.focus();
      assert(await last.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const sidebarBounds = node.closest('.dashboard-sidebar').getBoundingClientRect();
        return bounds.top >= sidebarBounds.top && bounds.bottom <= sidebarBounds.bottom && bounds.bottom <= innerHeight;
      }), 'Last sidebar destination must remain reachable on a short screen');
      if (height <= 640) assert(await sidebar.evaluate(node => getComputedStyle(node).overflowY === 'auto'), 'Short sidebars can scroll whenever content needs it');
      await screenshot('sidebar-scroll-end');
      const library = sidebar.getByRole('button', { name: lang === 'bm' ? 'Pustaka' : 'Library', exact: true });
      await library.focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(url => url.searchParams.get('view') === 'library');
      await page.waitForFunction(label => [...document.querySelectorAll('.dashboard-sidebar .dashboard-nav-item')]
        .some(node => node.textContent.trim() === label && node.getAttribute('aria-current') === 'page'),
      lang === 'bm' ? 'Pustaka' : 'Library');
      assert.equal(await library.getAttribute('aria-current'), 'page');
      await checkLayout();

      // The sidebar must not follow the changing height of the main section.
      // Exercise tall -> empty -> tall sections as well as independent scroll.
      const top = await sidebar.evaluate(node => node.getBoundingClientRect().top);
      const content = page.locator('.dashboard-content');
      const selectSection = async name => {
        await sidebar.getByRole('button', { name, exact: true }).click();
        await page.waitForFunction(label => [...document.querySelectorAll('.dashboard-sidebar .dashboard-nav-item')]
          .some(node => node.textContent.trim() === label && node.getAttribute('aria-current') === 'page'), name);
        await page.evaluate(() => document.fonts.ready);
      };
      for (const name of lang === 'bm' ? ['Notifikasi', 'Home', 'Bisnes Saya', 'Pustaka'] : ['Notifications', 'Home', 'My Business', 'Library']) {
        const previousScroll = await sidebar.evaluate(node => node.scrollTop);
        await selectSection(name);
        assert(Math.abs(await sidebar.evaluate(node => node.getBoundingClientRect().top) - top) < 1, 'Sidebar stays anchored across sections');
        assert.equal(await content.evaluate(node => node.scrollTop), 0, 'Only the main section resets its scroll');
        assert.equal(await page.evaluate(() => scrollY), 0, 'Desktop navigation cannot scroll the page');
        if (name === 'Library' || name === 'Pustaka') {
          assert.equal(await sidebar.evaluate(node => node.scrollTop), previousScroll, 'Visible menu navigation preserves sidebar scroll');
        }
      }
      await selectSection('Home');
      await content.locator('.home-view').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      await content.evaluate(node => { node.scrollTop = 180; });
      assert(await content.evaluate(node => node.scrollTop > 0), 'Long desktop content can scroll independently');
      const sidebarTop = await sidebar.evaluate(node => node.getBoundingClientRect().top);
      await selectSection(lang === 'bm' ? 'Notifikasi' : 'Notifications');
      assert(Math.abs(await sidebar.evaluate(node => node.getBoundingClientRect().top) - sidebarTop) < 1, 'Content scroll cannot shift the sidebar');
      assert.equal(await content.evaluate(node => node.scrollTop), 0);
      await screenshot('sidebar-stable-empty-section');
    } else {
      assert.equal(await sidebar.isVisible(), false);
      const buttons = await page.locator('.dashboard-bottom-nav > button').allInnerTexts();
      assert.deepEqual(buttons.slice(0, 4), lang === 'bm' ? ['Home', 'Aktiviti', 'Sembang', 'Pustaka'] : ['Home', 'Activity', 'Chat', 'Library']);
    }

    const beforeTask = [...operations];
    await page.goto(origin + `/app?view=work&run=${runId}`);
    const calendar = page.locator('.task-result .ask-calendar-connect');
    await calendar.waitFor();
    assert.equal(await page.locator('.task-result').getByText('jentera-connect', { exact: false }).count(), 0);
    const calendarSetup = calendar.getByRole('link', { name: lang === 'bm' ? 'Sambung Google Calendar' : 'Connect Google Calendar', exact: true });
    const destination = new URL(await calendarSetup.getAttribute('href'), origin);
    assert.equal(destination.pathname, '/api/connections/google-calendar/start');
    assert.equal(destination.search, '');
    assert.equal(await calendarSetup.getAttribute('target'), '_blank');
    assert.equal(await calendarSetup.getAttribute('rel'), 'noopener noreferrer');
    assert(await calendarSetup.evaluate(node => node.getBoundingClientRect().height >= 44));
    assert(await calendar.getByRole('button', { name: lang === 'bm' ? 'Salin pautan persediaan' : 'Copy setup link' }).evaluate(node => node.getBoundingClientRect().height >= 44));
    await calendarSetup.focus();
    assert(await calendarSetup.evaluate(node => node === document.activeElement));
    await checkLayout();
    await calendar.scrollIntoViewIfNeeded();
    await screenshot('activity-connection-card');

    await calendar.getByRole('button', { name: recovery.check, exact: true }).click();
    await calendar.getByText(recovery.missing).waitFor();
    assert.equal(await calendar.getByRole('button', { name: recovery.continue, exact: true }).count(), 0);
    await screenshot('recovery-calendar-missing');
    // Simulate the owner completing OAuth elsewhere; never call Google.
    rows.push({ id: 'fictional-google', connector: 'google', method: 'oauth', status: 'connected',
      displayName: 'Owner calendar', externalId: null, connectedAt: '', lastOkAt: null, lastError: null });
    paused = true;
    await calendar.getByRole('button', { name: recovery.again, exact: true }).click();
    await calendar.getByText(recovery.paused).waitFor();
    assert.equal(await calendar.getByRole('button', { name: recovery.continue, exact: true }).count(), 0);
    paused = false;
    await calendar.getByRole('button', { name: recovery.again, exact: true }).click();
    await calendar.getByText(recovery.ready).waitFor();
    await checkLayout();
    await screenshot('recovery-calendar-ready');
    await calendar.getByRole('button', { name: recovery.continue, exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('view') === 'chat');
    const composer = page.locator('.ask-writing-pad textarea');
    await composer.waitFor();
    assert((await composer.inputValue()).includes(recovery.context));
    assert((await composer.inputValue()).includes('Check Google Calendar access'));
    assert(!(await composer.inputValue()).includes('jentera-connect'));
    assert.deepEqual(operations, beforeTask, 'Continuing prepares a draft; it must not execute work or approve anything');
    await composer.fill('Existing follow-up draft');
    await page.getByLabel(lang === 'bm' ? 'Pilih fail untuk Jentera' : 'Choose a file for Jentera').setInputFiles({
      name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional context only'),
    });
    await page.getByRole('button', { name: lang === 'bm' ? 'Papan pemuka' : 'Dashboard', exact: false }).click();
    await page.waitForURL(url => url.searchParams.get('view') !== 'chat');
    await page.goto(origin + `/app?view=work&run=${runId}`);
    // A full navigation loses transient drafts/bytes by design. History and
    // the handoff remain recoverable, but there must be no stale ready signal.
    await calendar.getByRole('button', { name: recovery.check, exact: true }).waitFor();
    taskStatus = 'completed';
    await calendar.getByRole('button', { name: recovery.check, exact: true }).click();
    await calendar.getByText(recovery.finished).waitFor();
    assert.equal(await calendar.getByRole('button', { name: recovery.continue, exact: true }).count(), 0);
    taskStatus = 'needs_input';

    taskCase = 'browser';
    await page.goto(origin + `/app?view=work&run=${runId}`);
    const browserCard = page.locator('.task-result .ask-browser-handoff');
    await browserCard.getByRole('button', { name: recovery.browser, exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await checkLayout();
    await screenshot('recovery-browser-modal');
    await page.getByRole('button', { name: recovery.close, exact: true }).click();
    await browserCard.getByRole('button', { name: recovery.check, exact: true }).click();
    await browserCard.getByRole('button', { name: recovery.continue, exact: true }).waitFor();
    paused = true;
    await browserCard.getByRole('button', { name: recovery.continue, exact: true }).click();
    await browserCard.getByText(recovery.paused).waitFor();
    assert.equal(await browserCard.getByRole('button', { name: recovery.continue, exact: true }).count(), 0);
    paused = false;
    await browserCard.getByRole('button', { name: recovery.again, exact: true }).click();
    await browserCard.getByRole('button', { name: recovery.continue, exact: true }).waitFor();
    await browserCard.scrollIntoViewIfNeeded();
    assert((await browserCard.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).every(height => height >= 44));
    await checkLayout();
    await screenshot('recovery-browser-ready');
    assert.deepEqual(operations, beforeTask, 'Opening the browser and checking setup cannot claim, release, send, or approve');

    taskCase = 'code';
    await page.goto(origin + `/app?view=work&run=${runId}`);
    await page.locator('.task-result-text pre code').waitFor();
    assert.equal(await page.locator('.task-result-text strong').innerText(), 'Report ready');
    assert.equal(await page.locator('.task-result-text .reply-list li').count(), 2);
    assert.equal(await page.locator('.task-result-text .reply-table').count(), 1);
    assert(await page.locator('.reply-pre').evaluate(node => getComputedStyle(node).overflowX === 'auto' && node.scrollWidth > node.clientWidth));
    await checkLayout();
    await page.locator('.task-result').scrollIntoViewIfNeeded();
    await screenshot('activity-markdown');

    taskCase = 'invalid';
    await page.goto(origin + `/app?view=work&run=${runId}`);
    await page.locator('.task-result-text pre code').waitFor();
    assert.equal(await page.locator('.task-result .ask-calendar-connect').count(), 0);
    assert((await page.locator('.task-result-text pre code').innerText()).includes('https://example.com'));
    await checkLayout();

    taskCase = 'connect';
    await page.goto(origin + `/app?view=work&review=${runId}`);
    await page.locator('.task-result-text pre code').waitFor();
    assert.equal(await page.locator('.task-result .ask-calendar-connect').count(), 0, 'Shared reviews cannot offer private connection actions');
    assert.deepEqual(operations, beforeTask, 'Rendering results cannot connect, take control, approve or disconnect');
    await checkLayout();

    for (const path of ['/', '/onboard', '/setup', '/app']) {
      await page.goto(origin + path);
      await page.locator('main').waitFor();
      await page.waitForLoadState('networkidle');
      await checkLayout();
    }
    console.log(`${width}×${height} ${lang}/${theme}: sidebar · connectors · safe recovery/drafts · browser modal · Activity Markdown · keyboard · core routes · no overflow/errors`);
    await context.close();
  }
} finally {
  await browser.close();
}
