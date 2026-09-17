import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBusinessBrowser } from '../src/business-browser.mjs';

// Opt-in because a real Chromium install is needed. Uses an ephemeral CDP
// port and new profile; never connects to the owner's laptop Chrome on 9222.
test('real Chromium owner input, agent CDP handoff and persistent session', {
  skip: !process.env.BROWSER_SMOKE, timeout: 45000,
}, async () => {
  const { chromium } = await import('../../app/node_modules/playwright/index.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'jentera-browser-smoke-'));
  const config = { stateFile: join(dir, 'control.json'), profileDir: join(dir, 'profile') };
  let context;
  let agent;
  const deps = { chromium: {
    connectOverCDP: async () => { throw new Error('isolated smoke: no reattach'); },
    launchPersistentContext: async (path, options) => {
      context = await chromium.launchPersistentContext(path, {
        ...options, channel: process.env.BROWSER_SMOKE_CHANNEL || undefined,
        args: options.args.map((arg) => arg === '--remote-debugging-port=9222' ? '--remote-debugging-port=0' : arg),
      });
      await context.route('https://browser.test/**', (route) => route.fulfill({
        contentType: 'text/html', body: route.request().url().endsWith('/typing')
          ? `<input id="email"><input id="password" type="password"><button id="submit" onclick="window.submitted = (window.submitted || 0) + 1">Submit</button>
              <textarea id="notes"></textarea><input id="readonly" readonly><input id="disabled" disabled>
              <iframe srcdoc="<input id='embedded'>"></iframe><div id="shadow"></div>
              <script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<input id="nested">';</script>`
          : '<input id="login" autofocus><button onclick="localStorage.setItem(\'session\', document.querySelector(\'input\').value)">Sign in</button>',
      }));
      return context;
    },
  } };
  const owner = { ownerId: '11111111-1111-4111-8111-111111111111', controlId: '22222222-2222-4222-8222-222222222222' };
  try {
    const browser = createBusinessBrowser(config, deps);
    await browser.command({ ...owner, action: 'claim' });
    await browser.command({ ...owner, action: 'navigate', url: 'https://browser.test/login' });
    await context.pages()[0].locator('input').focus();
    await browser.command({ ...owner, action: 'text', text: 'synthetic-session' });
    await browser.command({ ...owner, action: 'key', key: 'Tab' });
    await browser.command({ ...owner, action: 'key', key: 'Enter' });
    const frame = await browser.command({ ...owner, action: 'frame' });
    assert.ok(Buffer.from(frame.image, 'base64').length > 1000);
    await browser.command({ ...owner, action: 'navigate', url: 'https://browser.test/typing' });
    const page = context.pages()[0];
    await page.locator('#email').click();
    let target = (await browser.command({ ...owner, action: 'frame' })).inputTarget;
    async function type(operation) {
      const result = await browser.command({ ...owner, action: 'input', inputId: target.id, sequence: target.nextSequence, ...operation });
      target = result.inputTarget;
      return result;
    }
    assert.equal(target.kind, 'text');
    const sent = { ...owner, action: 'input', inputId: target.id, sequence: target.nextSequence, text: 'boss@example.test' };
    target = (await browser.command(sent)).inputTarget;
    await browser.command(sent); // Replayed HTTP request cannot duplicate text.
    assert.equal(await page.locator('#email').inputValue(), 'boss@example.test');
    await type({ key: 'Tab' });
    assert.equal(target.kind, 'password');
    await type({ text: 'synthetic-password' });
    await type({ key: 'Backspace' });
    assert.equal(await page.locator('#password').inputValue(), 'synthetic-passwor');
    await type({ key: 'ControlOrMeta+A' });
    await type({ text: 'replacement✓' });
    assert.equal(await page.locator('#password').inputValue(), 'replacement✓');
    assert.deepEqual(Object.keys(target).sort(), ['id', 'kind', 'nextSequence']);
    await type({ key: 'Tab' });
    assert.equal(target.kind, 'control');
    await type({ key: 'Enter' });
    assert.equal(await page.evaluate(() => window.submitted), 1);

    // A website moving focus itself cannot retarget queued credentials.
    await page.locator('#email').focus();
    await assert.rejects(type({ text: 'never-type' }), { message: 'browser_input_changed', status: 409 });
    assert.equal(await page.locator('#email').inputValue(), 'boss@example.test');
    await page.locator('#notes').focus();
    target = (await browser.command({ ...owner, action: 'frame' })).inputTarget;
    assert.equal(target.kind, 'multiline');
    await type({ text: '你好' }); await type({ key: 'Enter' }); await type({ text: 'second line' });
    assert.equal(await page.locator('#notes').inputValue(), '你好\nsecond line');
    await page.locator('#readonly').focus();
    assert.equal((await browser.command({ ...owner, action: 'frame' })).inputTarget, null);
    await page.locator('#email').focus();
    target = (await browser.command({ ...owner, action: 'frame' })).inputTarget;
    await page.locator('#email').evaluate(node => { node.disabled = true; });
    await assert.rejects(type({ text: 'never-type' }), { message: 'browser_input_changed' });
    await page.frameLocator('iframe').locator('#embedded').focus();
    target = (await browser.command({ ...owner, action: 'frame' })).inputTarget;
    await type({ text: 'iframe text' });
    assert.equal(await page.frameLocator('iframe').locator('#embedded').inputValue(), 'iframe text');
    await page.locator('#nested').focus();
    target = (await browser.command({ ...owner, action: 'frame' })).inputTarget;
    await type({ text: 'shadow text' });
    assert.equal(await page.locator('#nested').inputValue(), 'shadow text');
    await browser.command({ ...owner, action: 'navigate', url: 'https://browser.test/login' });
    await assert.rejects(type({ text: 'old-page-secret' }), { message: 'browser_input_changed' });
    assert.deepEqual(JSON.parse(await readFile(config.stateFile, 'utf8')), { paused: true });
    await browser.command({ ...owner, action: 'release' });
    const port = (await readFile(join(config.profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    if (process.platform === 'linux') {
      const sockets = (await Promise.all(['/proc/net/tcp', '/proc/net/tcp6'].map((path) => readFile(path, 'utf8'))))
        .flatMap((table) => table.trim().split('\n').slice(1))
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields[3] === '0A' && parseInt(fields[1].split(':')[1], 16) === Number(port));
      assert.ok(sockets.length, 'CDP listener exists');
      for (const fields of sockets) {
        assert.ok(['0100007F', '00000000000000000000000001000000'].includes(fields[1].split(':')[0]),
          'CDP must listen on loopback only');
      }
    }
    agent = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    assert.equal(await agent.contexts()[0].pages()[0].evaluate(() => localStorage.getItem('session')), 'synthetic-session');
    await context.close();
    context = null;
    const restarted = createBusinessBrowser(config, deps);
    assert.equal(await restarted.isPaused(), false);
    await restarted.command({ ...owner, action: 'claim' });
    await restarted.command({ ...owner, action: 'navigate', url: 'https://browser.test/login' });
    assert.equal(await context.pages()[0].evaluate(() => localStorage.getItem('session')), 'synthetic-session');
    await restarted.command({ ...owner, action: 'release' });
  } finally {
    await context?.close();
    await agent?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
