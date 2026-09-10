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
        contentType: 'text/html', body: '<input id="login" autofocus><button onclick="localStorage.setItem(\'session\', document.querySelector(\'input\').value)">Sign in</button>',
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
