// Local browser QA with fictional accounts only. No payment, provider call,
// waitlist submission, email, group join or agent execution is allowed.
// pnpm preview --host 127.0.0.1 --port 4176
// CHECK_OUTPUT_DIR=/tmp/your-qa-dir node scripts/check-launch-funnel.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.CHECK_ORIGIN ?? 'http://127.0.0.1:4176';
const output = process.env.CHECK_OUTPUT_DIR;
const fakeInvite = `https://chat.whatsapp.com/${'A'.repeat(22)}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });
const snapshot = {
  onboarded: false, setupDone: false, bizType: 'restaurant', bizName: 'Fictional Café',
  bizLoc: 'Petaling Jaya', channels: [], conns: [], country: 'MY', approvals: [], permissions: {},
  workDone: {}, learn: {}, specialists: [], facts: [], canManageKnowledge: true,
};
try {
  for (const { width, height, lang = 'en', theme = 'dark' } of [
    { width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 1024, height: 900 }, { width: 1440, height: 1000 }, { width: 2048, height: 1200 },
    { width: 390, height: 844, lang: 'bm' },
    { width: 1440, height: 1000, theme: 'light' },
  ]) {
    const context = await browser.newContext({ viewport: { width, height },
      reducedMotion: process.env.CHECK_REDUCED_MOTION ?? 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; const writes = [];
    const fakeEmail = width === 320 ? `${'long'.repeat(15)}@${'business.'.repeat(20)}example` : 'owner@fictional-business.example';
    let signedIn = false; let paid = false; let accessGranted = true; let checkoutEnabled = false;
    let previewUsed = null;
    const previewQuota = () => previewUsed === null ? null : { limit: 10, used: previewUsed, remaining: 10 - previewUsed };
    let state = { ...snapshot, lang, theme };
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      // The public header intentionally probes the session. A fictional
      // signed-out 401 there is expected; all other errors still fail QA.
      if (!signedIn && ['/api/me', '/api/billing/status'].some(path => message.location().url.includes(path)) && message.text().includes('401')) return;
      if (signedIn && !accessGranted && message.location().url.includes('/api/me') && message.text().includes('403')) return;
      if (message.type() === 'error') errors.push(message.text());
    });
    await context.addInitScript(({ lang, theme }) => {
      localStorage.setItem('aisar-lang', lang); localStorage.setItem('aisar-theme', theme);
    }, { lang, theme });
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      // Remove only the Pages-injected analytics tag from fixture navigation.
      // Replacing its JS would violate the tag's integrity hash. Keep app
      // assets and their security attributes unchanged; never send QA analytics.
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
      if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ contentType: 'application/javascript',
        body: 'window.turnstile = { render: () => "fictional-widget", reset: () => {}, remove: () => {}, execute: () => {} };' });
      if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
      const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization, Idempotency-Key' };
      if (request.method() === 'OPTIONS' || url.pathname === '/api/events') return route.fulfill({ status: 204, headers });
      let body;
      if (url.pathname === '/api/me') {
        body = signedIn ? { ok: true, userId: 'fictional-owner', email: fakeEmail, detailLevel: 'simple', features: {} } : { ok: false };
        // A deliberate signed-out result, not an unexpected browser failure.
        if (!signedIn) return route.fulfill({ status: 401, headers, contentType: 'application/json', body: JSON.stringify(body) });
        if (!accessGranted) return route.fulfill({ status: 403, headers, contentType: 'application/json', body: JSON.stringify({ code: 'ACCESS_REQUIRED' }) });
      } else if (url.pathname === '/api/access') body = { restricted: true, signedIn,
        access: { allowed: signedIn && accessGranted, kind: paid ? 'paid' : previewUsed === null ? 'trial' : 'preview', preview: previewQuota() }, founderGroup: signedIn && paid ? { url: fakeInvite } : null, billing: { checkoutEnabled } };
      else if (url.pathname === '/api/billing/status') {
        if (!signedIn) return route.fulfill({ status: 401, headers, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
        body = { ok: true, checkoutEnabled, mode: checkoutEnabled ? 'live' : null, activation: 'inactive',
          offer: { initialMonthlyAmount: 99, introductoryMonths: 3, renewalMonthlyAmount: 199, currency: 'MYR' }, state: null, preview: previewQuota() };
      }
      else if (url.pathname === '/api/runtime/provision' && request.method() === 'POST' && new URL(page.url()).pathname === '/setup') {
        writes.push('fixture-only provision'); body = { ok: true };
      } else if (url.pathname === '/api/runtime/wake' && request.method() === 'POST' && new URL(page.url()).pathname === '/app') {
        // Existing dashboard reconnect behavior, fulfilled locally only.
        writes.push('fixture-only wake'); body = { ok: true };
      } else if (url.pathname === '/api/auth/logout' && request.method() === 'POST' && new URL(page.url()).pathname === '/subscribe') {
        writes.push('fixture-only logout'); signedIn = false; body = { ok: true };
      } else if (request.method() !== 'GET') {
        errors.push(`Unexpected write: ${request.method()} ${url.pathname}`); return route.fulfill({ status: 400 });
      } else if (url.pathname === '/api/state') body = { ok: true, snapshot: state };
      else if (url.pathname === '/api/connections') body = { ok: true, connections: [] };
      else if (url.pathname === '/api/runtime') body = { ok: true, runtime: { status: 'ready', desiredRelease: 'fictional-release',
        observedRelease: 'fictional-release', lastReadyAt: new Date().toISOString(), lastError: null }, usage: {} };
      else if (url.pathname === '/api/runs/activity') body = { ok: true, work: [], counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 } };
      else if (url.pathname === '/api/notifications') body = { ok: true, items: [], notifications: [], unread: 0, nextCursor: null };
      else if (url.pathname === '/api/workspaces') body = { ok: true, workspaces: [], canManage: true };
      else if (url.pathname === '/api/goals') body = { ok: true, available: true, canManage: true, goals: [] };
      else if (url.pathname === '/api/agent/memory') body = { ok: true, available: true, profiles: [] };
      else if (url.pathname === '/api/browser') body = { ok: true, enabled: true, paused: false, controlled: false };
      else { errors.push('Missing fixture: ' + url.pathname); return route.fulfill({ status: 404 }); }
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const layout = async route => {
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} ${width}px overflow`);
      assert.deepEqual(errors, [], `${route} ${width}px browser errors`);
      if (output) await page.screenshot({ path: `${output}/${route}-${width}-${lang}-${theme}.png` });
      if (output && route === 'business-paid') await page.locator('.founder-group-invite').screenshot({ path: `${output}/founder-card-${width}-${lang}-${theme}.png` });
    };
    const launchOfferLocation = async source => {
      await page.waitForURL(origin + '/#pricing');
      await page.waitForFunction(async () => {
        const pricing = document.getElementById('pricing');
        const top = pricing?.getBoundingClientRect().top;
        const headerBottom = document.querySelector('.marketing-header')?.getBoundingClientRect().bottom ?? 0;
        if (scrollY <= 100 || top === undefined || top < headerBottom || top > innerHeight / 2) return false;
        const before = scrollY;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return Math.abs(scrollY - before) <= 1;
      });
      assert(await page.locator('#pricing').isVisible(), `${source} lands on the launch offer at ${width}px`);
      assert.equal(writes.length, 0, 'viewing the offer must never create a checkout or charge');
    };

    await page.goto(origin + '/');
    await page.getByRole('heading', { name: /AI staff that works 24\/7/ }).waitFor();
    assert.match(await page.locator('body').innerText(), /RM199/);
    assert(!/Purchases are not open yet|no payment today/i.test(await page.locator('body').innerText()), 'landing removes outdated purchase notice');
    assert.equal(await page.locator('a[href*="chat.whatsapp.com"]').count(), 0);
    const benefits = page.getByRole('list', { name: 'Launch plan inclusions' });
    assert.equal(await benefits.getByRole('listitem').count(), 6);
    assert.match(await page.locator('#pricing').innerText(), /Save RM300 over your first 3 months/);
    assert(!/Automation Mapping|One computer task at a time|Approvals and activity history/.test(await benefits.innerText()),
      'launch benefits exclude service promises, usage restrictions and technical feature labels');
    assert.equal(await page.getByRole('heading', { name: /You stay in control.*Of important actions/i }).count(), 1);
    const hero = await page.locator('.lp-hero-copy').boundingBox();
    assert(hero, 'landing hero should be visible');
    for (const selector of ['.lp-hero-offer']) {
      const box = await page.locator(selector).boundingBox();
      assert(box && Math.abs(box.x + box.width / 2 - hero.x - hero.width / 2) <= 1,
        `${selector} should be centered beneath the hero action at ${width}px`);
    }
    assert.equal(await page.locator('.lp-hero-benefits').count(), 0, 'restore the original hero without the added benefits grid');
    assert.equal(await page.locator('.hero-hours').innerText(), '24/7', 'restore the original 24/7 highlight');
    const skipLink = page.locator('.marketing-skip-link');
    assert.equal(await skipLink.evaluate(link => getComputedStyle(link).clipPath), 'inset(50%)', 'skip link stays hidden below the announcement');
    await skipLink.focus();
    assert.equal(await skipLink.evaluate(link => getComputedStyle(link).clipPath), 'none', 'keyboard focus reveals the skip link');
    await skipLink.evaluate(link => link.blur());
    await layout('landing');
    const announcement = page.getByRole('complementary', { name: 'Jentera launch announcement' });
    assert.match(await announcement.innerText(), /RM99.*3 months.*RM199/s);
    const barHeight = await announcement.evaluate(bar => bar.getBoundingClientRect().height);
    assert(barHeight <= (width < 768 ? 96 : 45), `announcement should stay slim at ${width}px, got ${barHeight}px`);
    for (const control of [announcement.getByRole('link'), announcement.getByRole('button')]) {
      const box = await control.boundingBox();
      assert(box && box.height >= 44, 'announcement actions keep accessible touch targets');
    }
    assert.equal(await announcement.getByRole('link').getAttribute('href'), '/#pricing');
    await announcement.getByRole('link').click();
    await launchOfferLocation('landing announcement');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await announcement.getByRole('link').focus();
    await page.keyboard.press('Enter');
    await launchOfferLocation('repeated fragment via keyboard');
    await announcement.getByRole('button', { name: 'Dismiss launch announcement' }).click();
    assert.equal(await announcement.count(), 0);
    assert.equal(writes.length, 0, 'announcement must never create an account or charge');
    await page.getByRole('link', { name: 'Try my AI staff — 10 free chats' }).click();
    await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/signin', 'the public launch action goes straight to sign-in');
    assert.equal(await page.locator('a[href*="chat.whatsapp.com"]').count(), 0);
    await layout('signin-first');
    await page.goto(origin + '/subscribe');
    await page.getByRole('link', { name: 'Create account or sign in' }).waitFor();
    await layout('subscribe-signed-out');
    await page.goto(origin + '/waitlist');
    await page.getByRole('heading', { name: 'Your first AI staff.' }).waitFor();
    assert.match(await page.locator('body').innerText(), /Joining the waitlist is free and does not start a subscription/i);
    assert.equal(await page.locator('a[href*="chat.whatsapp.com"]').count(), 0);
    await layout('waitlist');
    await page.goto(origin + '/signin');
    await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
    assert.equal(await page.getByRole('complementary', { name: 'Jentera launch announcement' }).count(), 1);
    assert.equal(await page.getByRole('region', { name: 'Welcome to Jentera!' }).count(), 0);
    await layout('signin');
    await page.getByRole('link', { name: 'View launch offer' }).click();
    await launchOfferLocation('sign-in announcement');

    signedIn = true; accessGranted = false;
    await page.goto(origin + '/access');
    await page.getByRole('region', { name: 'Welcome to Jentera!' }).waitFor();
    assert.match(await page.getByRole('region', { name: 'Welcome to Jentera!' }).innerText(), /You’re signed in/);
    assert.equal(await page.locator('a[href*="chat.whatsapp.com"]').count(), 0);
    assert.equal(writes.length, 0, 'welcome must not activate access or redeem an invite');
    await layout('signed-in-access');

    checkoutEnabled = true;
    await page.goto(origin + '/signin');
    await page.getByRole('button', { name: 'Subscribe — RM99/month' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/subscribe', 'a verified unpaid account continues to its plan without an extra click');
    assert.match(await page.locator('body').innerText(), /then RM199\/month from month 4/);
    assert.equal(await page.locator('a[href*="chat.whatsapp.com"]').count(), 0);
    await layout('subscribe-ready');
    await page.getByRole('link', { name: 'Back to website' }).click();
    await page.getByRole('heading', { name: /AI staff that works 24\/7/ }).waitFor();
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    assert.equal(new URL(page.url()).pathname, '/', 'the public-site exit must not loop back to subscribe');
    await page.goto(origin + '/subscribe?checkout=complete&paid=true');
    await page.getByRole('status').filter({ hasText: 'Waiting for Stripe' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Go to my workspace' }).count(), 0);
    assert.equal(writes.length, 0, 'fake success and polling cannot create a checkout or grant access');
    await layout('subscribe-pending');
    checkoutEnabled = false;

    signedIn = true; paid = true; accessGranted = true;
    await page.goto(origin + '/onboard');
    const title = lang === 'bm' ? 'Apa yang anda mahu Staf AI bantu dahulu?' : 'What would you like your AI Staff to help with first?';
    await page.getByRole('heading', { name: title }).waitFor();
    await page.getByRole('region', { name: lang === 'bm' ? 'Selamat datang ke Jentera!' : 'Welcome to Jentera!' }).waitFor();
    const groupLink = page.locator('a[href="' + fakeInvite + '"]');
    await groupLink.waitFor();
    assert.equal(await groupLink.getAttribute('rel'), 'noopener noreferrer');
    await layout('onboard');
    await page.getByRole('button', { name: lang === 'bm' ? /Laporan/ : /Reports/ }).click();
    await page.getByRole('textbox').fill('Turn my Friday sales spreadsheet into a weekly report.');
    await page.getByRole('button', { name: lang === 'bm' ? 'Pilih sebagai aliran kerja pertama' : 'Use this as my first workflow' }).click();
    await page.getByRole('heading', { name: lang === 'bm' ? 'Di mana saya boleh belajar tentang bisnes anda?' : 'Where can I learn about your business?' }).waitFor();
    assert.equal(writes.length, 0, 'choosing a task must not provision or execute');
    await layout('business-intro');

    state = { ...state, onboarded: true, facts: [{ key: 'business.workflow.task', value: 'Prepare my weekly report.', source: 'owner',
      sourceRef: null, confidence: 1, confirmed: true, confirmedAt: new Date().toISOString(), createdAt: new Date().toISOString(), version: 1 }] };
    await page.goto(origin + '/setup');
    await page.getByRole('region', { name: lang === 'bm' ? 'Kenali Staf AI anda.' : 'Meet your AI Staff.' }).waitFor();
    await page.locator('a[href="' + fakeInvite + '"]').waitFor();
    assert.match(await page.getByRole('textbox').inputValue(), /Prepare my weekly report/);
    await layout('setup');

    state = { ...state, setupDone: true };
    await page.goto(origin + '/app?view=business&tab=profile');
    await page.locator('a[href="' + fakeInvite + '"]').waitFor();
    await layout('business-paid');
    await page.locator('.account-menu-trigger').click();
    assert.equal(await page.locator('.account-menu-email').innerText(), fakeEmail, 'account menu identifies the signed-in email');
    assert(await page.locator('.account-menu-email').evaluate(element => element.scrollWidth <= element.clientWidth),
      'long account emails wrap without horizontal overflow');
    assert(!await page.evaluate(() => Object.values(localStorage).join('')).then(value => value.includes(fakeEmail)),
      'display identity is not persisted in browser storage');
    await layout('account-menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.account-menu-email').count(), 0, 'closing the menu removes the email from the visible page');
    paid = false;
    const trialResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/access');
    await page.reload();
    await page.getByRole('heading', { level: 1 }).waitFor();
    await trialResponse;
    assert.equal(await page.locator('a[href*="chat.whatsapp.com"]').count(), 0, 'trial must not receive the invitation');
    assert(!await page.evaluate(() => Object.values(localStorage).join('')).then(value => value.includes(fakeInvite)), 'invite must not be stored');
    await layout('business-trial');
    checkoutEnabled = true; previewUsed = 0;
    await page.goto(origin + '/app?view=chat');
    await page.getByText(lang === 'bm' ? '10 daripada 10 chat percuma berbaki' : '10 of 10 free chats left').waitFor();
    assert(await page.locator('.ask-writing-pad').isVisible(), 'a free account can use Chat before subscribing');
    assert.equal(await page.locator('a[href*="chat.whatsapp.com"]').count(), 0, 'preview must not unlock paid founder support');
    await layout('chat-preview');
    previewUsed = 10;
    await page.evaluate(() => window.dispatchEvent(new Event('jentera:preview-change')));
    await page.getByRole('heading', { name: lang === 'bm' ? '10 chat percuma anda telah digunakan.' : 'Your 10 free chats are complete.' }).waitFor();
    assert.equal(await page.locator('.ask-writing-pad').count(), 0, 'exhaustion replaces only the composer, not the conversation');
    await layout('chat-exhausted');
    await page.locator('.ask-preview-upgrade a').click();
    await page.getByRole('heading', { name: 'Your free chats are complete.' }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Try Jentera/ }).count(), 0, 'subscribe cannot restart the free preview');
    await layout('subscribe-exhausted');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: /AI staff that works 24\/7/ }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/', 'sign-out returns to the public site');
    assert.equal(signedIn, false, 'sign-out was confirmed by the fictional server');
    assert(writes.every(write => ['fixture-only provision', 'fixture-only wake', 'fixture-only logout'].includes(write)));
    console.log(`PASS launch routes and paid/trial invitation: ${width}px ${lang} ${theme}`);
    await context.close();
  }
} finally { await browser.close(); }
