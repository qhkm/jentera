import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createBusinessBrowser, browserCommandProblem, desktopBrowserArguments } from '../src/business-browser.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111';
const controlId = '22222222-2222-4222-8222-222222222222';
const command = (action, extra = {}) => ({ action, ownerId, controlId, ...extra });
function fixture(desktopEnabled = false, extras = {}) {
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
  const config = { stateFile: '/private/control.json', profileDir: '/private/profile', desktopEnabled };
  Object.assign(deps, extras);
  return { browser: createBusinessBrowser(config, deps), files, typed, page, context, chromium: deps.chromium,
    advance: (ms) => { clock += ms; }, launches: () => launches,
    restart: () => createBusinessBrowser(config, deps) };
}

test('desktop uses the same persistent profile, native viewport and headed Chrome without attesting agent computer use', async () => {
  const f = fixture(true); let options;
  const launch = f.chromium.launchPersistentContext;
  f.chromium.launchPersistentContext = async (profile, opts) => { options = opts; return launch(profile, opts); };
  await f.browser.command(command('claim'));
  assert.equal(options.headless, false); assert.equal(options.viewport, null);
  assert.equal(options.chromiumSandbox, true);
  assert.ok(options.args.includes('--restore-last-session'));
  assert.equal((await f.browser.status()).desktopView, 1);
  assert.equal(f.browser.desktopControlValid(command('claim')), true);
  assert.equal(f.browser.desktopControlValid(command('claim', { controlId: ownerId })), false);
  assert.ok(!JSON.stringify(await f.browser.status()).includes('computer_use'));
});

test('desktop cleanup must finish before release/reclaim; failure keeps durable pause and existing lease', async () => {
  const f = fixture(true); await f.browser.command(command('claim'));
  let fail = true;
  f.browser.onControlChanging(async () => { assert.equal(await f.browser.isPaused(), true); if (fail) throw new Error('cleanup unavailable'); });
  await assert.rejects(f.browser.command(command('release')), /cleanup unavailable/);
  await assert.rejects(f.browser.command(command('reclaim', { controlId: ownerId })), /cleanup unavailable/);
  assert.deepEqual([...f.files.values()], ['{"paused":true}']);
  assert.equal(f.browser.desktopControlValid(command('claim')), true);
  fail = false; await f.browser.command(command('release'));
  assert.equal(await f.browser.isPaused(), false);
});

test('desktop capability disappears when the local gateway is not ready; legacy viewer stays available', async () => {
  const f = fixture(true, { desktopReady: () => false });
  assert.equal((await f.browser.status()).desktopView, undefined);
  assert.equal((await f.browser.status()).directTyping, 1);
});

test('headless migration happens only after durable pause and only for the exact business profile', async () => {
  for (const wrongProfile of [false, true]) {
    const f = fixture(true); const attached = new EventEmitter(); let closed = false;
    attached.contexts = () => [f.context];
    attached.newBrowserCDPSession = async () => ({
      send: async method => {
        if (method === 'Browser.getBrowserCommandLine') return { arguments: ['--headless', `--user-data-dir=${wrongProfile ? '/other/profile' : '/private/profile'}`] };
        assert.equal(method, 'Browser.close'); assert.equal(await f.browser.isPaused(), true);
        closed = true; attached.emit('disconnected');
      }, detach: async () => {},
    });
    f.chromium.connectOverCDP = async () => attached;
    if (wrongProfile) {
      await assert.rejects(f.browser.command(command('claim')), /browser_unavailable/);
      assert.equal(closed, false); assert.equal(f.launches(), 0);
    } else {
      await f.browser.command(command('claim')); assert.equal(closed, true); assert.equal(f.launches(), 1);
    }
    assert.deepEqual([...f.files.values()], ['{"paused":true}']);
  }
});

test('native browser identification rejects absent/ambiguous instances and ignores Chromium child processes', async () => {
  const args = ['/usr/lib/chromium/chromium', '--headless', '--remote-debugging-port=9222', '--user-data-dir=/private/profile'];
  for (const joined of [false, true]) {
    const io = { readdir: async () => ['1', '2', 'net'], readFile: async path => Buffer.from(path.includes('/1/') ? args.join(joined ? ' ' : '\0') : [...args, '--type=renderer'].join('\0')) };
    assert.deepEqual(await desktopBrowserArguments(io), args);
    await assert.rejects(desktopBrowserArguments({ ...io, readFile: async () => Buffer.from(args.join('\0')) }), /identity unavailable/);
    await assert.rejects(desktopBrowserArguments({ ...io, readdir: async () => [] }), /identity unavailable/);
  }
});

function typingFixture() {
  const f = fixture();
  let focused = { tagName: 'INPUT', type: 'password', isConnected: true, getAttribute: () => null };
  const handle = node => ({ node, asElement() { return this; },
    evaluate: async (fn, other) => fn(node, other?.node ?? other), dispose: async () => {},
  });
  const frame = { evaluateHandle: async () => handle(focused) };
  f.page.mainFrame = () => frame;
  return { ...f, focus: node => { focused = node; } };
}

test('explicit same-owner recovery replaces a live window without resuming or replacing the browser', async () => {
  const f = typingFixture();
  const nextControl = '33333333-3333-4333-8333-333333333333';
  assert.equal((await f.browser.status()).controlRecovery, 1);
  await f.browser.command(command('claim'));
  const oldTarget = (await f.browser.command(command('frame'))).inputTarget;
  await assert.rejects(f.browser.command(command('claim', { controlId: nextControl })), { message: 'browser_controlled', status: 409 });
  await f.browser.command(command('reclaim', { controlId: nextControl }));
  assert.equal(await f.browser.isPaused(), true);
  assert.equal(f.launches(), 1);
  assert.deepEqual([...f.files.values()], ['{"paused":true}']);
  const target = (await f.browser.command(command('frame', { controlId: nextControl }))).inputTarget;
  assert.notEqual(target.id, oldTarget.id);
  for (const action of ['frame', 'text', 'click', 'input']) {
    await assert.rejects(f.browser.command(command(action, { text: 'stale-secret', x: 1, y: 1, inputId: oldTarget.id, sequence: 1 })),
      { message: 'browser_control_expired', status: 409 });
  }
  await assert.rejects(f.browser.command(command('release')), { message: 'browser_controlled', status: 409 });
  await f.browser.command(command('input', { controlId: nextControl, inputId: target.id, sequence: 1, text: 'new-window' }));
  assert.deepEqual(f.typed, ['new-window']);
  await f.browser.command(command('release', { controlId: nextControl }));
  assert.equal(await f.browser.isPaused(), false);
});

test('recovery cannot displace a different owner or disclose controller credentials', async () => {
  const f = fixture();
  await f.browser.command(command('claim'));
  const stranger = { ownerId: '33333333-3333-4333-8333-333333333333', controlId: '44444444-4444-4444-8444-444444444444' };
  await assert.rejects(f.browser.command(command('reclaim', stranger)), { message: 'browser_controlled', status: 409 });
  assert.equal(await f.browser.isPaused(), true);
  const status = JSON.stringify(await f.browser.status());
  assert.ok(!status.includes(ownerId) && !status.includes(controlId));
  await f.browser.command(command('frame'));
  f.advance(10 * 60 * 1000 + 1);
  await f.browser.command(command('reclaim', stranger));
  assert.equal(await f.browser.isPaused(), true);
});

test('direct typing is field-bound, ordered, deduplicated and never persisted', async () => {
  const f = typingFixture();
  await f.browser.command(command('claim'));
  const first = await f.browser.command(command('click', { x: 10, y: 20 }));
  assert.equal(first.directTyping, 1);
  assert.equal(first.inputTarget.kind, 'password');
  const input = command('input', { inputId: first.inputTarget.id, sequence: 1, text: 'synthetic-secret' });
  const sent = await f.browser.command(input);
  assert.equal(sent.inputTarget.nextSequence, 2);
  await f.browser.command(input);
  assert.deepEqual(f.typed, ['synthetic-secret']);
  await assert.rejects(f.browser.command({ ...input, sequence: 4 }), { message: 'browser_input_sequence', status: 409 });
  assert.deepEqual([...f.files.values()], ['{"paused":true}']);
  await f.browser.command(command('release'));
  await assert.rejects(f.browser.command({ ...input, sequence: 2 }), { message: 'browser_control_expired' });
});

test('a focus change, disabled/read-only field, navigation or reclaim invalidates queued direct input', async () => {
  for (const change of ['focus', 'readonly', 'disabled', 'navigation', 'claim', 'expiry']) {
    const f = typingFixture();
    await f.browser.command(command('claim'));
    const { inputTarget } = await f.browser.command(command('frame'));
    if (change === 'navigation') f.page.url = () => 'https://example.com/changed';
    else if (change === 'claim') await f.browser.command(command('claim'));
    else if (change === 'expiry') f.advance(10 * 60 * 1000 + 1);
    else f.focus({ tagName: 'INPUT', type: 'password', isConnected: true,
      readOnly: change === 'readonly', disabled: change === 'disabled', getAttribute: () => null });
    await assert.rejects(f.browser.command(command('input', { inputId: inputTarget.id, sequence: 1, text: 'never-type' })),
      { message: change === 'expiry' ? 'browser_control_expired' : 'browser_input_changed', status: 409 });
    assert.deepEqual(f.typed, []);
  }
});

test('direct typing rejects malformed sessions, mixed commands and unapproved shortcuts', () => {
  const input = command('input', { inputId: controlId, sequence: 1, text: 'hello' });
  assert.equal(browserCommandProblem(input), null);
  for (const extra of [{ inputId: 'invalid' }, { sequence: 0 }, { sequence: 1.5 }, { text: '' },
    { text: 'x'.repeat(4097) }, { key: 'Enter' }, { text: undefined, key: 'F12' }, { text: undefined, key: undefined }]) {
    assert.ok(browserCommandProblem({ ...input, ...extra }));
  }
});

test('a hung focus inspection times out, permits hand-back and discards a late field handle', { timeout: 5000 }, async () => {
  const f = typingFixture();
  let finish;
  let disposed = 0;
  const element = { asElement() { return this; }, evaluate: async () => 'password', dispose: async () => { disposed++; } };
  f.page.mainFrame = () => ({ evaluateHandle: () => new Promise(resolve => { finish = resolve; }) });
  await f.browser.command(command('claim'));
  assert.equal((await f.browser.command(command('frame'))).inputTarget, null);
  assert.equal(await f.browser.isPaused(), true, 'Timeout must not silently hand control back');
  await f.browser.command(command('release'));
  finish(element);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1);
  assert.equal(await f.browser.isPaused(), false);
  assert.equal((await f.browser.status()).controlled, false);
  assert.deepEqual(f.typed, []);
});

test('Tab rebinds to the next field and allows Enter on a button, but never text', async () => {
  const f = typingFixture();
  await f.browser.command(command('claim'));
  const { inputTarget } = await f.browser.command(command('frame'));
  f.page.keyboard.press = async () => f.focus({ tagName: 'BUTTON', isConnected: true, getAttribute: () => null });
  const next = await f.browser.command(command('input', { inputId: inputTarget.id, sequence: 1, key: 'Tab' }));
  assert.equal(next.inputTarget.kind, 'control');
  assert.notEqual(next.inputTarget.id, inputTarget.id);
  await assert.rejects(f.browser.command(command('input', { inputId: next.inputTarget.id, sequence: 1, text: 'never-type' })), { message: 'browser_input_changed' });
  await f.browser.command(command('input', { inputId: next.inputTarget.id, sequence: 1, key: 'Enter' }));
  assert.deepEqual(f.typed, []);
});

test('preview never launches or claims a browser and blocks private URLs', async () => {
  const f = fixture();
  assert.equal((await f.browser.preview()).previewStatus, 'loading');
  assert.equal(f.launches(), 0);
  await f.browser.ensure();
  f.advance(5000);
  assert.equal((await f.browser.preview()).previewStatus, 'private');
  assert.equal(await f.browser.isPaused(), false);
});

test('preview returns ephemeral frames only after both privacy checks and throttles', async () => {
  const f = fixture();
  f.page.url = () => 'https://example.com/docs';
  let checks = 0;
  f.page.evaluate = async () => { checks++; return true; };
  await f.browser.ensure();
  const frame = await f.browser.preview();
  assert.equal(frame.previewStatus, 'ready');
  assert.equal(frame.capturedAt, 1000);
  assert.equal(checks, 2);
  assert.equal((await f.browser.preview()).previewStatus, 'waiting');
  assert.equal(f.files.size, 0);
  f.advance(8000);
  f.page.evaluate = async () => false;
  assert.equal((await f.browser.preview()).image, undefined);
});

test('preview reconnects to an existing browser without launching or writing control state', async () => {
  const f = fixture();
  f.chromium.connectOverCDP = async () => ({ contexts: () => [f.context] });
  f.page.url = () => 'https://example.com/docs';
  f.page.evaluate = async () => true;
  assert.equal((await f.browser.preview()).previewStatus, 'ready');
  assert.equal(f.launches(), 0);
  assert.equal(f.files.size, 0);
  assert.equal(await f.browser.isPaused(), false);
});

test('screencast keeps only the latest frame, acknowledges input and detaches on privacy', async () => {
  const f = fixture();
  f.page.url = () => 'https://example.com/docs';
  f.page.evaluate = async () => true;
  f.page.screenshot = async () => { throw new Error('must not screenshot'); };
  const session = new EventEmitter();
  const commands = [];
  let detached = 0;
  session.send = async (name, args) => { commands.push({ name, args }); };
  session.detach = async () => { detached++; };
  f.context.newCDPSession = async () => session;
  await f.browser.ensure();
  assert.equal((await f.browser.preview({ streaming: true })).previewStatus, 'waiting');
  for (const data of ['YWJj', 'ZGVm']) session.emit('Page.screencastFrame', { data, sessionId: 1 });
  f.advance(110);
  assert.equal((await f.browser.preview({ streaming: true })).image, 'ZGVm');
  assert.equal(commands.filter(c => c.name === 'Page.screencastFrameAck').length, 2);
  f.advance(110);
  assert.equal((await f.browser.preview({ streaming: true })).previewStatus, 'waiting');
  f.page.evaluate = async () => false;
  session.emit('Page.screencastFrame', { data: 'private', sessionId: 1 });
  f.advance(110);
  assert.equal((await f.browser.preview({ streaming: true })).previewStatus, 'private');
  assert.equal(detached, 1);
  assert.equal(session.listenerCount('Page.screencastFrame'), 0);
});

test('screencast invalidates buffered frames when navigation starts', async () => {
  const f = fixture();
  f.page.url = () => 'https://example.com/docs';
  f.page.evaluate = async () => true;
  const session = new EventEmitter();
  session.send = async () => {};
  session.detach = async () => {};
  f.context.newCDPSession = async () => session;
  await f.browser.ensure();
  await f.browser.preview({ streaming: true });
  session.emit('Page.screencastFrame', { data: 'old', sessionId: 1 });
  session.emit('Page.frameStartedLoading', {});
  f.advance(110);
  assert.equal((await f.browser.preview({ streaming: true })).previewStatus, 'navigating');
  await f.browser.stopScreencast();
  assert.equal(session.listenerCount('Page.frameStartedLoading'), 0);
});

test('preview discards navigated frames before applying privacy checks to the new page', async () => {
  const f = fixture();
  f.page.url = () => 'https://example.com/docs';
  f.page.evaluate = async () => true;
  f.page.screenshot = async () => { f.page.url = () => 'https://example.com/checkout'; return Buffer.from('secret'); };
  await f.browser.ensure();
  assert.equal((await f.browser.preview()).previewStatus, 'navigating');
  f.advance(5000);
  assert.equal((await f.browser.preview()).previewStatus, 'private');
  await f.browser.command(command('claim'));
  assert.equal((await f.browser.preview()).previewStatus, 'paused');
});

test('overlapping viewers do not duplicate capture; a claim/release invalidates the in-flight image', async () => {
  const f = fixture();
  f.page.url = () => 'https://example.com/docs';
  f.page.evaluate = async () => true;
  let release;
  let began;
  const started = new Promise(r => { began = r; });
  f.page.screenshot = () => { began(); return new Promise(r => { release = r; }); };
  await f.browser.ensure();
  const first = f.browser.preview();
  await started;
  assert.equal((await f.browser.preview()).previewStatus, 'waiting');
  await f.browser.command(command('claim'));
  await f.browser.command(command('release'));
  release(Buffer.from('old-screen'));
  assert.equal((await first).previewStatus, 'waiting');
  assert.equal(await f.browser.isPaused(), false);
});

test('safe navigation during a capture is not reported as a privacy block', async () => {
  const f = fixture();
  f.page.url = () => 'https://example.com/docs';
  f.page.evaluate = async () => true;
  f.page.screenshot = async () => {
    f.page.url = () => 'https://example.com/next';
    return Buffer.from('obsolete-screen');
  };
  await f.browser.ensure();
  assert.deepEqual(await f.browser.preview(), { previewStatus: 'navigating' });
});

test('failed privacy checks release capture lock and never expose error details', async () => {
  const f = fixture();
  f.page.url = () => 'https://example.com/docs';
  f.page.evaluate = async () => { throw new Error('private page details'); };
  await f.browser.ensure();
  assert.deepEqual(await f.browser.preview(), { previewStatus: 'unavailable' });
  f.advance(8000);
  f.page.evaluate = async () => true;
  assert.equal((await f.browser.preview()).previewStatus, 'ready');
  assert.equal(await f.browser.isPaused(), false);
});

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
  await restarted.command(command('claim'));
  await restarted.command(command('release'));
  assert.equal(await restarted.isPaused(), false);
});

/* Handing back is the safe direction — it is how the agent gets its browser
   again — and it used to be gated behind a live lease like every other action.
   So an owner whose control expired could not hand back at all: the browser
   stayed paused, and a paused browser makes the runner refuse every task
   (`slotBusy`). On 15 September a Google sign-in ran past the ten minutes,
   and that business's agent answered nothing for the rest of the day.

   The pause itself still survives — a half-finished login is not handed to the
   agent by a timeout, only by someone saying so. What changed is that saying
   so is always possible. */
test('an expired controller can still hand the browser back', async () => {
  const f = fixture();
  await f.browser.command(command('claim'));
  f.advance(11 * 60 * 1000);
  assert.equal(await f.browser.isPaused(), true);
  await f.browser.command(command('release'));
  assert.equal(await f.browser.isPaused(), false);
});

test('a fresh window can hand back a browser left paused by an expired session', async () => {
  const f = fixture();
  await f.browser.command(command('claim'));
  f.advance(11 * 60 * 1000);
  const laterWindow = { action: 'release', ownerId, controlId: '33333333-3333-4333-8333-333333333333' };
  await f.browser.command(laterWindow);
  assert.equal(await f.browser.isPaused(), false);
});

test('handing back is refused while someone else still holds live control', async () => {
  const f = fixture();
  await f.browser.command(command('claim'));
  const otherWindow = { action: 'release', ownerId, controlId: '33333333-3333-4333-8333-333333333333' };
  await assert.rejects(f.browser.command(otherWindow), /browser_controlled/);
  assert.equal(await f.browser.isPaused(), true);
});

/* Ten minutes was a cap on the whole session, not on idleness: the lease was
   set at the claim and nothing extended it, so control died mid-flow however
   actively it was being used. The sign-ins this browser exists for — Google
   with MFA, a bank — routinely run longer, and the owner lost the screen with
   a half-typed password on it. */
test('using the browser renews control instead of expiring ten minutes after the claim', async () => {
  const f = fixture();
  await f.browser.command(command('claim'));
  for (let minute = 0; minute < 20; minute++) {
    f.advance(60 * 1000);
    await f.browser.command(command('frame'));
  }
  assert.equal((await f.browser.command(command('frame'))).width, 1280);
  f.advance(11 * 60 * 1000);
  await assert.rejects(f.browser.command(command('frame')), /browser_control_expired/);
});

/* ---- harvesting a connector's credentials -----------------------------
   The one action that reads a value off the page instead of putting one
   there, so its refusals matter more than its happy path. */

function harvestFixture(pageUrl = 'https://aisar.bukku.my/dashboard', values = {}, toggleOn = true) {
  const goneTo = [];
  const clicked = [];
  const fields = { '#api_access_token': 'aaaaaaaa.bbbbbbbb.cccccccc', '#subdomain': 'aisar', ...values };
  const page = {
    isClosed: () => false, url: () => pageUrl,
    setViewportSize: async () => {}, screenshot: async () => Buffer.from('screenshot'),
    goto: async (url) => { goneTo.push(url); }, mouse: { click: async () => {}, wheel: async () => {} },
    keyboard: { insertText: async () => {}, press: async () => {} },
    inputValue: async (selector) => fields[selector] ?? '',
    waitForTimeout: async () => {},
    locator: (selector) => ({
      evaluate: async (fn, cls) => fn({ classList: { contains: () => toggleOn } }, cls),
      click: async () => { clicked.push(selector); },
    }),
  };
  const context = { pages: () => [page], setDefaultTimeout: () => {}, on: () => {} };
  const deps = {
    now: () => 1000,
    chromium: {
      connectOverCDP: async () => { throw new Error('not running'); },
      launchPersistentContext: async () => context,
    },
    fs: { mkdir: async () => {}, readFile: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); },
      writeFile: async () => {}, rename: async () => {} },
  };
  const browser = createBusinessBrowser(
    { stateFile: '/private/control.json', profileDir: '/private/profile', desktopEnabled: false }, deps);
  return { browser, goneTo, clicked };
}

test('harvest names a recipe, never a selector or a script', () => {
  assert.equal(browserCommandProblem(command('harvest', { connector: 'bukku' })), null);
  assert.equal(browserCommandProblem(command('harvest', { connector: 'not-a-service' })), 'invalid_connector');
  assert.equal(browserCommandProblem(command('harvest', {})), 'invalid_connector');
  /* The shapes an eval endpoint would have accepted. */
  assert.equal(browserCommandProblem(command('harvest', { connector: '#api_access_token' })), 'invalid_connector');
  assert.equal(browserCommandProblem(command('harvest', { connector: { path: '/cp/integrations' } })), 'invalid_connector');
});

test('harvest reads the recipe fields from the service the owner signed into', async () => {
  const f = harvestFixture();
  await f.browser.command(command('claim'));
  const result = await f.browser.command(command('harvest', { connector: 'bukku' }));
  assert.deepEqual(result.fields, { token: 'aaaaaaaa.bbbbbbbb.cccccccc', subdomain: 'aisar' });
  /* On the owner's own subdomain, not a host the recipe chose. */
  assert.equal(f.goneTo.at(-1), 'https://aisar.bukku.my/cp/integrations');
});

test('harvest refuses when the owner is not on that service', async () => {
  const f = harvestFixture('https://mail.example.com/inbox');
  await f.browser.command(command('claim'));
  await assert.rejects(
    () => f.browser.command(command('harvest', { connector: 'bukku' })),
    (error) => error.message === 'browser_not_signed_in' && error.status === 409,
  );
  /* And went nowhere: a redirect must not turn into a credential read. */
  assert.equal(f.goneTo.length, 0);
});

test('harvest turns access on only when it is off, and never refreshes', async () => {
  const on = harvestFixture('https://aisar.bukku.my/dashboard', {}, true);
  await on.browser.command(command('claim'));
  await on.browser.command(command('harvest', { connector: 'bukku' }));
  /* Already on: the existing token is read and nothing is generated, because
     generating invalidates whatever else the owner has wired to Bukku. */
  assert.deepEqual(on.clicked, []);

  const off = harvestFixture('https://aisar.bukku.my/dashboard', {}, false);
  await off.browser.command(command('claim'));
  await off.browser.command(command('harvest', { connector: 'bukku' }));
  assert.deepEqual(off.clicked, ['#api_access_on']);
});

test('harvest hands on nothing when the page has changed under it', async () => {
  for (const values of [{ '#api_access_token': '' }, { '#api_access_token': 'Enable API access' }, { '#subdomain': '' }]) {
    const f = harvestFixture('https://aisar.bukku.my/dashboard', values);
    await f.browser.command(command('claim'));
    await assert.rejects(
      () => f.browser.command(command('harvest', { connector: 'bukku' })),
      (error) => /^browser_(missing|unexpected)_/.test(error.message),
    );
  }
});
