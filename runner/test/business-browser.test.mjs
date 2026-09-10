import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBusinessBrowser, browserCommandProblem } from '../src/business-browser.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111';
const controlId = '22222222-2222-4222-8222-222222222222';
const command = (action, extra = {}) => ({ action, ownerId, controlId, ...extra });
function fixture() {
  const files = new Map();
  let clock = 1000;
  let launches = 0;
  const typed = [];
  const page = {
    isClosed: () => false, url: () => 'https://example.com/private?token=secret',
    setViewportSize: async () => {}, screenshot: async () => Buffer.from('screenshot'),
    goto: async () => {}, mouse: { click: async () => {}, wheel: async () => {} },
    keyboard: { insertText: async (value) => typed.push(value), press: async () => {} },
  };
  const context = { pages: () => [page], setDefaultTimeout: () => {}, on: () => {} };
  const deps = {
    now: () => clock,
    chromium: {
      connectOverCDP: async () => { throw new Error('not running'); },
      launchPersistentContext: async (path, opts) => {
        assert.equal(path, '/private/profile');
        assert.ok(opts.args.includes('--remote-debugging-port=9222'));
        assert.ok(!opts.args.some((arg) => arg.startsWith('--remote-debugging-address=')));
        launches += 1; return context;
      },
    },
    fs: {
      mkdir: async () => {},
      readFile: async (path) => {
        if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return files.get(path);
      },
      writeFile: async (path, bytes) => files.set(path, bytes),
      rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    },
  };
  const config = { stateFile: '/private/control.json', profileDir: '/private/profile' };
  return { browser: createBusinessBrowser(config, deps), files, typed,
    advance: (ms) => { clock += ms; }, launches: () => launches,
    restart: () => createBusinessBrowser(config, deps) };
}

test('rejects unsafe URLs, arbitrary keyboard shortcuts, scripts and malformed inputs', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com',
    'https://127.0.0.1', 'https://[::1]', 'https://10.0.0.1', 'https://user:pass@example.com']) {
    assert.equal(browserCommandProblem(command('navigate', { url })), 'invalid_url');
  }
  assert.equal(browserCommandProblem(command('navigate', { url: 'https://example.com/login' })), null);
  assert.equal(browserCommandProblem(command('eval', { script: 'alert(1)' })), 'invalid_command');
  assert.equal(browserCommandProblem(command('key', { key: 'Control+Shift+J' })), 'invalid_key');
  assert.equal(browserCommandProblem(command('text', { text: 'a'.repeat(4097) })), 'invalid_text');
  assert.equal(browserCommandProblem(command('click', { x: NaN, y: 1 })), 'invalid_position');
});

test('exclusive control pauses agents and hand-back reuses the same persistent browser', async () => {
  const f = fixture();
  assert.equal(await f.browser.isPaused(), false);
  await f.browser.command(command('claim'));
  assert.equal(await f.browser.isPaused(), true);
  await assert.rejects(f.browser.command(command('claim', { controlId: ownerId })), /browser_controlled/);
  await assert.rejects(f.browser.command(command('text', { ownerId: controlId, text: 'password' })), /browser_control_expired/);
  await f.browser.command(command('text', { text: 'password' }));
  const frame = await f.browser.command(command('frame'));
  assert.equal(frame.tabs[0].origin, 'https://example.com');
  assert.ok(!JSON.stringify([...f.files]).includes('password'));
  assert.ok(!JSON.stringify([...f.files]).includes('screenshot'));
  assert.deepEqual(f.typed, ['password']);
  await f.browser.command(command('release'));
  assert.equal(await f.browser.isPaused(), false);
  await f.browser.ensure();
  assert.equal(f.launches(), 1);
  await assert.rejects(f.browser.command(command('frame')), /browser_control_expired/);
});

test('expired control and runner restarts stay paused until a new explicit hand-back', async () => {
  const f = fixture();
  await f.browser.command(command('claim'));
  f.advance(11 * 60 * 1000);
  await assert.rejects(f.browser.command(command('frame')), /browser_control_expired/);
  assert.equal(await f.browser.isPaused(), true);
  const restarted = f.restart();
  assert.equal(await restarted.isPaused(), true);
  await assert.rejects(restarted.command(command('release')), /browser_control_expired/);
  await restarted.command(command('claim'));
  await restarted.command(command('release'));
  assert.equal(await restarted.isPaused(), false);
});
