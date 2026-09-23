import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = new Set(['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'ControlOrMeta+A',
  'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+Home', 'Shift+End']);
const LEASE_MS = 10 * 60 * 1000;
export const BROWSER_VIEWPORT = Object.freeze({ width: 1280, height: 800 });

/** Linux fallback for Chrome builds that don't expose command-line CDP.
 * Identify ONE native browser using the fixed loopback debugging port, then
 * verify its exact profile at the call site. Never log/return process args. */
export async function desktopBrowserArguments(io = { readdir, readFile }) {
  const processes = (await io.readdir('/proc')).filter(name => /^[1-9][0-9]*$/.test(name));
  if (processes.length > 4096) throw new Error('Browser identity unavailable');
  let found;
  for (const pid of processes) {
    let raw;
    try { raw = await io.readFile(`/proc/${pid}/cmdline`); } catch { continue; }
    if (raw.length > 128 * 1024) continue;
    let args = raw.toString().split('\0').filter(Boolean);
    // Chromium may rewrite argv into a single native process title. Our
    // profile/debugging flags contain no whitespace and must be exact tokens,
    // not substrings in a URL or a different profile path.
    if (args.length === 1) args = args[0].split(/\s+/);
    if (!/\/(?:chrome|chromium|chrome-headless-shell|headless_shell)$/.test(args[0] ?? '') ||
        args.some(arg => arg.startsWith('--type=')) || !args.includes('--remote-debugging-port=9222')) continue;
    if (found) throw new Error('Browser identity unavailable');
    found = args;
  }
  if (!found) throw new Error('Browser identity unavailable');
  return found;
}

import { browserRecipe, recipeProblem, recipeUrl } from './browser-recipes.mjs';
import { createProcedureRecorder } from './procedure-recorder.mjs';

export class BrowserProblem extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

export function browserCommandProblem(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid_command';
  if (!['claim', 'reclaim', 'frame', 'navigate', 'click', 'text', 'key', 'input', 'scroll', 'tab', 'release', 'harvest', 'restart',
    'record_start', 'record_stop', 'record_cancel'].includes(body.action)) return 'invalid_command';
  if (!UUID.test(body.ownerId ?? '') || !UUID.test(body.controlId ?? '')) return 'invalid_controller';
  if (body.action === 'navigate') {
    try {
      const url = new URL(body.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) return 'invalid_url';
      if (['localhost', 'metadata.google.internal'].includes(url.hostname) ||
          /(^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^0\.|:|\.internal$|\.local$)/i.test(url.hostname)) return 'invalid_url';
    } catch { return 'invalid_url'; }
  }
  if (body.action === 'click' && (!Number.isFinite(body.x) || !Number.isFinite(body.y) ||
      body.x < 0 || body.y < 0 || body.x >= BROWSER_VIEWPORT.width || body.y >= BROWSER_VIEWPORT.height)) return 'invalid_position';
  if (body.action === 'text' && (typeof body.text !== 'string' || body.text.length > 4096)) return 'invalid_text';
  if (body.action === 'key' && !KEYS.has(body.key)) return 'invalid_key';
  if (body.action === 'input') {
    if (!UUID.test(body.inputId ?? '') || !Number.isSafeInteger(body.sequence) || body.sequence < 1) return 'invalid_input_session';
    if ((typeof body.text === 'string') === (typeof body.key === 'string')) return 'invalid_input';
    if (body.text !== undefined && (typeof body.text !== 'string' || !body.text.length || body.text.length > 4096)) return 'invalid_text';
    if (body.key !== undefined && !KEYS.has(body.key)) return 'invalid_key';
  }
  if (body.action === 'scroll' && (!Number.isFinite(body.deltaY) || Math.abs(body.deltaY) > 1600)) return 'invalid_scroll';
  if (body.action === 'tab' && (!Number.isInteger(body.index) || body.index < 0 || body.index > 50)) return 'invalid_tab';
  if (body.action === 'record_start' && (typeof body.objective !== 'string' || !body.objective.trim() || body.objective.trim().length > 240)) return 'invalid_objective';
  /* The caller names a recipe, never a selector or a script. */
  if (body.action === 'harvest' && !browserRecipe(body.connector)) return 'invalid_connector';
  return null;
}

/** One browser, one business. The only durable control state is paused/not
 * paused. Controller credentials and screen/input contents never reach disk. */
export function createBusinessBrowser(config, deps = {}) {
  const now = deps.now ?? Date.now;
  const fs = { mkdir, readFile, writeFile, rename, ...deps.fs };
  let paused = true; // Fail closed until the durable state has been read.
  let lease = null;
  let busy = false;
  let context = null;
  let selected = null;
  let launching = null;
  let desktopAttached = false;
  let previewing = false;
  let lastPreview = -Infinity;
  let controlRevision = 0;
  let cast = null;
  let input = null;
  const procedureRecorder = createProcedureRecorder({ now });
  const controlListeners = new Set();
  async function changingControl() {
    procedureRecorder.cancel();
    // Desktop keys are released BEFORE the durable pause can be cleared.
    for (const listener of controlListeners) await listener();
  }
  async function clearInput() {
    const previous = input;
    input = null;
    if (previous) await bounded(previous.element.dispose()).catch(() => {});
  }
  // No field values, DOM labels, cookies or selectors cross this boundary.
  // A handle identifies one actual node, not a selector that could retarget.
  async function inspectFocusedInput(page) {
    let frame = page.mainFrame?.();
    for (let depth = 0; frame && depth < 8; depth++) {
      let handle;
      try {
        handle = await frame.evaluateHandle(() => {
          let element = document.activeElement;
          while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
          return element;
        });
        const element = handle.asElement();
        if (!element) { await handle.dispose(); return null; }
        const kind = await element.evaluate(node => {
          if (!node.isConnected || node.disabled || node.readOnly || node.getAttribute('aria-disabled') === 'true') return null;
          if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') return 'frame';
          if (node.tagName === 'TEXTAREA' || node.isContentEditable) return 'multiline';
          if (['BUTTON', 'SELECT', 'A'].includes(node.tagName) || (node.tagName === 'INPUT' && ['submit', 'button', 'checkbox', 'radio'].includes(node.type))) return 'control';
          if (node.tagName !== 'INPUT' || !['text', 'password', 'email', 'search', 'url', 'tel', 'number'].includes(node.type)) return null;
          return node.type === 'password' ? 'password' : 'text';
        });
        if (kind === 'frame') { frame = await element.contentFrame(); await handle.dispose(); continue; }
        if (!kind) { await handle.dispose(); return null; }
        return { element, frame, kind, url: page.url() };
      } catch { await handle?.dispose().catch(() => {}); return null; }
    }
    return null;
  }
  async function focusedInput(page) {
    const pending = inspectFocusedInput(page);
    try { return await bounded(pending); }
    catch {
      // A hung website must not lock owner control indefinitely. Read-only
      // inspection may finish late; discard its handle, never restore a target.
      void pending.then(focused => focused?.element.dispose()).catch(() => {});
      return null;
    }
  }
  async function inputTarget(page) {
    const focused = await focusedInput(page);
    if (!focused) { await clearInput(); return null; }
    let same = false;
    if (input?.page === page && input.frame === focused.frame && input.url === focused.url && input.kind === focused.kind) {
      same = await bounded(input.element.evaluate((node, other) => node === other, focused.element)).catch(() => false);
    }
    if (same) await bounded(focused.element.dispose()).catch(() => {});
    else {
      await clearInput();
      input = { ...focused, page, id: randomUUID(), nextSequence: 1 };
    }
    return { id: input.id, kind: input.kind, nextSequence: input.nextSequence };
  }
  async function ownerFrame(page, pages) {
    await page.setViewportSize(BROWSER_VIEWPORT);
    const bytes = await page.screenshot({ type: 'jpeg', quality: 65, timeout: 5000 });
    if (bytes.length > 750000) throw new BrowserProblem(503, 'browser_frame_too_large');
    return {
      image: bytes.toString('base64'), ...BROWSER_VIEWPORT, expiresAt: lease.expiresAt,
      directTyping: 1, inputTarget: await inputTarget(page),
      tabs: pages.map((p, index) => {
        let origin = 'Browser';
        try { origin = new URL(p.url()).origin; } catch { /* No internal URL details. */ }
        return { index, origin, selected: p === page };
      }).slice(0, 51),
    };
  }
  async function bounded(operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('preview_timeout')), 1500);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function stopScreencast() {
    const previous = cast;
    cast = null;
    if (!previous) return;
    previous.frame = null;
    previous.session.off('Page.screencastFrame', previous.receive);
    previous.session.off('Page.frameStartedLoading', previous.invalidate);
    previous.session.off('Page.frameNavigated', previous.invalidate);
    // Detaching stops this viewer only, never the browser or agent.
    await bounded(previous.session.detach()).catch(() => {});
  }
  async function screencastFrame(page) {
    if (cast?.page !== page) {
      await stopScreencast();
      let expired = false;
      const opening = context.newCDPSession(page).then(session => {
        if (expired) { void session.detach().catch(() => {}); throw new Error('preview_expired'); }
        return session;
      });
      let session;
      try { session = await bounded(opening); } catch (error) { expired = true; throw error; }
      const current = { session, page, frame: null, revision: 0, navigating: false };
      current.invalidate = () => { current.revision++; current.frame = null; current.navigating = true; };
      current.receive = event => {
        // Latest-frame-only buffer; acknowledgement never waits on a viewer.
        if (cast === current && typeof event.data === 'string' && event.data.length <= 670000) {
          current.frame = { image: event.data, capturedAt: now(), revision: current.revision, url: page.url() };
          current.navigating = false;
        }
        void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      };
      cast = current;
      session.on('Page.screencastFrame', current.receive);
      session.on('Page.frameStartedLoading', current.invalidate);
      session.on('Page.frameNavigated', current.invalidate);
      try {
        await bounded(session.send('Page.enable'));
        await bounded(session.send('Page.startScreencast', { format: 'jpeg', quality: 45, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 }));
      } catch (error) { await stopScreencast(); throw error; }
    }
    const frame = cast.frame;
    cast.frame = null;
    return frame ?? (cast.navigating ? { navigating: true } : null);
  }
  const loaded = (async () => {
    try {
      const saved = JSON.parse(await fs.readFile(config.stateFile, 'utf8'));
      paused = saved.paused !== false;
    } catch (error) {
      if (error.code === 'ENOENT') paused = false;
    }
  })();

  function observeContext(ctx) {
    const track = page => {
      page.on?.('framenavigated', frame => {
        if (frame === page.mainFrame()) selected = page;
      });
    };
    ctx.pages().forEach(track);
    ctx.on('page', page => { selected = page; track(page); });
    ctx.on('close', () => { if (context === ctx) { context = null; selected = null; desktopAttached = false; } });
  }

  async function persist(value) {
    await fs.mkdir(dirname(config.stateFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(`${config.stateFile}.next`, JSON.stringify({ paused: value }), { mode: 0o600 });
    await fs.rename(`${config.stateFile}.next`, config.stateFile);
    paused = value;
  }
  /** Close the live browser and prove it went. `Browser.close` may reject
   *  because its own transport dies with the shutdown it asked for, so the
   *  `disconnected` event is the proof, not the call. Leaving `context` set
   *  after a failed close would let the next `ensure()` launch a second
   *  browser on the same profile directory. */
  async function closeBrowser() {
    if (!context) return;
    const browser = context.browser?.() ?? null;
    if (!browser) {
      // A context with no browser handle cannot prove it went; closing the
      // context is the strongest statement available.
      await context.close?.().catch(() => {});
      context = null; selected = null; desktopAttached = false;
      return;
    }
    const closed = new Promise(resolve => browser.once('disconnected', resolve));
    await browser.close().catch(() => {});
    let timer;
    try {
      await Promise.race([closed, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new BrowserProblem(503, 'browser_unavailable')), 10000);
      })]);
    } finally { clearTimeout(timer); }
    context = null;
    selected = null;
    desktopAttached = false;
  }

  async function ensure() {
    if (context && context.pages().some((p) => !p.isClosed()) &&
        (!config.desktopEnabled || desktopAttached || !paused)) return context;
    if (launching) return launching;
    launching = (async () => {
      let restoreUrl = null;
      let didLaunch = false;
      const chromium = deps.chromium ?? (await import(config.playwrightEntry)).chromium;
      await fs.mkdir(config.profileDir, { recursive: true, mode: 0o700 });
      // Reattach after a runner restart if the browser survived it.
      try {
        const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 1500 });
        context = browser.contexts()[0];
        if (config.desktopEnabled && paused) {
          const session = await browser.newBrowserCDPSession();
          try {
            let args;
            try { ({ arguments: args } = await session.send('Browser.getBrowserCommandLine')); }
            catch { args = await (deps.desktopBrowserArguments ?? desktopBrowserArguments)(); }
            if (!Array.isArray(args) || !args.includes(`--user-data-dir=${config.profileDir}`)) throw new BrowserProblem(503, 'browser_unavailable');
            if (args.some(arg => arg.startsWith('--headless')) || args.includes('--no-sandbox')) {
              // Only our exact persistent profile may be migrated, and only
              // after an explicit owner claim has durably paused the agent.
              restoreUrl = selected?.url() ?? context.pages().find(page => page.url() !== 'about:blank')?.url() ?? null;
              const closed = new Promise(resolve => browser.once('disconnected', resolve));
              // Browser.close may reject because its transport is closed by
              // the successful shutdown. The disconnected event is the proof.
              await session.send('Browser.close').catch(() => {});
              let timer;
              try {
                await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new BrowserProblem(503, 'browser_unavailable')), 10000); })]);
              } finally { clearTimeout(timer); }
              context = null;
            }
            desktopAttached = true;
          } finally { await session.detach().catch(() => {}); }
        }
      } catch {
        // A failed migration must not launch a second browser on the profile.
        if (context) throw new BrowserProblem(503, 'browser_unavailable');
      }
      if (!context) {
        didLaunch = true;
        context = await chromium.launchPersistentContext(config.profileDir, {
          headless: !config.desktopEnabled, viewport: config.desktopEnabled ? null : BROWSER_VIEWPORT,
          // Human desktop launch must keep Chromium's own sandbox. Do not
          // silently fall back to --no-sandbox if the host cannot support it.
          chromiumSandbox: Boolean(config.desktopEnabled),
          // Chromium's CDP HTTP server binds loopback by default. Explicit
          // --remote-debugging-address hangs startup on some Sprite hosts;
          // keep the default and verify the actual bind in the Linux smoke.
          args: ['--remote-debugging-port=9222', '--restore-last-session',
            ...(config.desktopEnabled ? ['--start-maximized', '--window-size=1280,800'] : [])],
          timeout: 20000, acceptDownloads: false,
        });
        desktopAttached = Boolean(config.desktopEnabled);
      }
      if (!context) throw new BrowserProblem(503, 'browser_unavailable');
      if (!context.pages().length) await context.newPage();
      context.setDefaultTimeout(5000);
      observeContext(context);
      if (config.desktopEnabled && paused && didLaunch) {
        // Persistent-session restore also opens a new blank tab. Bring the
        // actual previous business page forward, not that empty startup tab.
        selected = context.pages().find(page => page.url() === restoreUrl) ??
          context.pages().find(page => page.url() !== 'about:blank') ?? context.pages()[0];
        await selected.bringToFront?.();
      }
      return context;
    })();
    try { return await launching; } finally { launching = null; }
  }
  function controlledBy(body) {
    return lease && lease.expiresAt > now() && lease.ownerId === body.ownerId && lease.controlId === body.controlId;
  }
  async function status() {
    await loaded;
    return { enabled: true, paused, controlled: Boolean(lease && lease.expiresAt > now()), directTyping: 1, controlRecovery: 1,
      procedureCapture: 1, ...procedureRecorder.status(),
      ...(config.desktopEnabled && (deps.desktopReady?.() ?? true) ? { desktopView: 1 } : {}) };
  }
  async function isPaused() { await loaded; return paused || busy; }

  async function command(body) {
    const problem = browserCommandProblem(body);
    if (problem) throw new BrowserProblem(400, problem);
    await loaded;
    if (busy) throw new BrowserProblem(409, 'browser_busy');
    controlRevision++;
    busy = true;
    try {
      if (body.action === 'claim' || body.action === 'reclaim') {
        // Only an explicit recovery by the SAME authenticated owner may
        // replace a live window. Normal claims and other owners still conflict.
        if (lease && lease.expiresAt > now() && !controlledBy(body) &&
            !(body.action === 'reclaim' && lease.ownerId === body.ownerId)) throw new BrowserProblem(409, 'browser_controlled');
        await changingControl();
        await clearInput();
        await persist(true);
        lease = { ownerId: body.ownerId, controlId: body.controlId, expiresAt: now() + LEASE_MS };
        await ensure();
        return { ...(await status()), expiresAt: lease.expiresAt };
      }
      /* Handing back is the safe direction — it is how the agent gets its
         browser back — so unlike every other action it does not need a live
         lease. Gating it behind one meant an owner whose control expired could
         not hand back at all, and a paused browser makes the runner refuse
         every task: one sign-in that ran past ten minutes on 15 September left
         that business's agent answering nothing. Only someone else's live
         control is a reason to refuse.

         The pause still outlives the lease. A half-finished login is handed to
         the agent when a person says so and not because a timer ran out; what
         changed is that saying so is always possible. */
      if (body.action === 'release') {
        if (lease && lease.expiresAt > now() && !controlledBy(body)) {
          throw new BrowserProblem(409, 'browser_controlled');
        }
        await changingControl();
        await persist(false);
        lease = null;
        await clearInput();
        return status();
      }
      // A displaced window must not invalidate the new controller's input.
      if (!paused || !controlledBy(body)) throw new BrowserProblem(409, 'browser_control_expired');
      if (body.action === 'restart') {
        /* Recovery, not a hand-back: the durable pause and the lease both
           survive, so the owner still holds the browser they just repaired.
           Order matters. Viewers go first, because desktop-gateway.mjs latches
           cleanupBlocked on a failed teardown and that latch refuses every
           future desktop stream until reviewed recovery -- a far worse state
           than the wedged browser this is meant to fix. */
        /* Tolerated, not ignored: `disconnect()` throws once the gateway has
           latched, and restart is the recovery for exactly that state — so
           gating it on a clean teardown disabled the fix whenever it was
           needed. The viewer's socket is destroyed by that call either way.
           Other actions still fail closed on a latched gateway. */
        await changingControl().catch(() => {});
        await stopScreencast();
        await clearInput();
        await closeBrowser();
        await ensure();
        /* Only once a new browser is up: the native key release answers what
           the latch guards, and clears it when it succeeds. */
        await deps.recoverDesktop?.();
        return status();
      }
      /* Idle timeout, not a cap on the session. The lease used to be set at the
         claim and never extended, so control died ten minutes later however
         actively it was being used — and the sign-ins this browser exists for
         run longer than that. The owner lost the screen mid-flow, with a
         half-typed password on it. */
      lease.expiresAt = now() + LEASE_MS;
      const ctx = await ensure();
      const pages = ctx.pages().filter((p) => !p.isClosed());
      const page = selected && !selected.isClosed() ? selected : pages[0];
      if (body.action === 'record_start') {
        try { await procedureRecorder.start(ctx, body.objective); }
        catch (error) { throw new BrowserProblem(409, error.message); }
        return { ok: true, ...(await status()) };
      }
      if (body.action === 'record_stop') {
        try { return { ok: true, ...(await status()), recording: false, procedureDraft: procedureRecorder.stop() }; }
        catch (error) { throw new BrowserProblem(409, error.message); }
      }
      if (body.action === 'record_cancel') {
        procedureRecorder.cancel();
        return { ok: true, ...(await status()) };
      }
      if (['navigate', 'click', 'tab', 'text', 'key'].includes(body.action)) await clearInput();
      if (body.action === 'tab') {
        if (!pages[body.index]) throw new BrowserProblem(400, 'invalid_tab');
        selected = pages[body.index];
      } else if (body.action === 'navigate') {
        await page.goto(body.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } else if (body.action === 'click') await page.mouse.click(body.x, body.y);
      else if (body.action === 'input') {
        const target = await inputTarget(page);
        if (!target || target.id !== body.inputId) throw new BrowserProblem(409, 'browser_input_changed');
        if (body.text !== undefined && target.kind === 'control') throw new BrowserProblem(409, 'browser_input_changed');
        if (body.sequence === input.nextSequence - 1) return { ok: true, ...(await ownerFrame(page, pages)) };
        if (body.sequence !== input.nextSequence) throw new BrowserProblem(409, 'browser_input_sequence');
        // Advance before dispatch: an ambiguous transport/execution failure
        // must never repeat a deletion, submission or credential insertion.
        input.nextSequence++;
        try {
          if (body.text !== undefined) await page.keyboard.insertText(body.text);
          else await page.keyboard.press(body.key);
        } catch (error) { await clearInput(); throw error; }
      }
      else if (body.action === 'harvest') {
        const recipe = browserRecipe(body.connector);
        /* On the service the owner signed into, or nowhere. A redirect, or
           an owner who wandered, must not have us reading a credential-shaped
           field off whatever site happens to be open. */
        const target = recipeUrl(recipe, page.url());
        if (!target) throw new BrowserProblem(409, 'browser_not_signed_in');
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (recipe.toggle) {
          const on = await page.locator(recipe.toggle.selector)
            .evaluate((el, cls) => el.classList.contains(cls), recipe.toggle.onClass)
            .catch(() => null);
          if (on === null) throw new BrowserProblem(409, 'browser_page_changed');
          /* Off means no token exists yet, so turning it on creates the
             first one. Already on means one exists and is read as it is —
             nothing is generated, because generating would invalidate
             whatever else the owner has wired to this service. */
          if (on === false) {
            await page.locator(recipe.toggle.selector).click({ timeout: 5000 });
            await page.waitForTimeout(1500);
          }
        }
        const fields = {};
        for (const [name, selector] of Object.entries(recipe.read)) {
          fields[name] = (await page.inputValue(selector, { timeout: 5000 }).catch(() => '')).trim();
        }
        const problem = recipeProblem(recipe, fields);
        if (problem) throw new BrowserProblem(409, `browser_${problem}`);
        return { ok: true, fields };
      }
      else if (body.action === 'text') await page.keyboard.insertText(body.text);
      else if (body.action === 'key') await page.keyboard.press(body.key);
      else if (body.action === 'scroll') await page.mouse.wheel(0, body.deltaY);
      if (body.action === 'frame') return ownerFrame(page, pages);
      if (body.action === 'click' || body.action === 'input') return { ok: true, ...(await ownerFrame(page, pages)) };
      return { ok: true };
    } finally { busy = false; }
  }
  async function preview({ streaming = false } = {}) {
    await loaded;
    if (paused || lease && lease.expiresAt > now()) { await stopScreencast(); return { previewStatus: 'paused' }; }
    if (busy || previewing || now() - lastPreview < (streaming ? 100 : 5000)) return { previewStatus: 'waiting' };
    previewing = true;
    lastPreview = now();
    try {
      if (!context || !context.pages().some(p => !p.isClosed())) {
        // A runner restart/cold wake loses its in-memory CDP connection.
        // Attach only: preview must never launch a browser or claim control.
        try {
          const chromium = deps.chromium ?? (await import(config.playwrightEntry)).chromium;
          const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 1500 });
          context = browser.contexts()[0];
          selected = null;
          if (context) observeContext(context);
        } catch { return { previewStatus: 'loading' }; }
      }
      if (!context) return { previewStatus: 'loading' };
      const pages = context.pages().filter(p => !p.isClosed());
      const page = selected && !selected.isClosed() ? selected : pages.at(-1);
      if (!page || page.url() === 'about:blank') { await stopScreencast(); return { previewStatus: 'loading' }; }
      const revision = controlRevision;
      const safe = async () => {
        const url = new URL(page.url());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
            /login|signin|sign-in|auth|checkout|payment|billing|account|password|token/i.test(url.href)) return false;
        // Fail closed for forms, embedded frames and editable content. These
        // checks reduce exposure, but are not a guarantee of public content.
        let timer;
        try {
          return await Promise.race([
            page.evaluate(() => !document.querySelector('input, textarea, select, iframe, frame, [contenteditable="true"], [autocomplete]')),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('privacy_check_timeout')), 1000); }),
          ]);
        } finally { clearTimeout(timer); }
      };
      const before = page.url();
      if (!await safe()) { await stopScreencast(); return { previewStatus: 'private' }; }
      const frame = streaming ? await screencastFrame(page) : null;
      if (streaming && frame?.navigating) return { previewStatus: 'navigating' };
      if (streaming && !frame) return { previewStatus: 'waiting' };
      const bytes = streaming ? null : await page.screenshot({ type: 'jpeg', quality: 45, timeout: 3000 });
      const interrupted = () => {
        if (paused || lease && lease.expiresAt > now()) return 'paused';
        if (busy || controlRevision !== revision) return 'waiting';
        const currentPages = context.pages().filter(p => !p.isClosed());
        const currentPage = selected && !selected.isClosed() ? selected : currentPages.at(-1);
        if (page.isClosed() || currentPage !== page || page.url() !== before || (streaming &&
            (!cast || cast.page !== page || frame.revision !== cast.revision || frame.url !== before))) return 'navigating';
        return null;
      };
      // A tab or URL change invalidates the captured bytes, but is not a
      // privacy failure by itself. The next iteration evaluates the new page.
      let interruption = interrupted();
      if (interruption) { await stopScreencast(); return { previewStatus: interruption }; }
      if (!await safe()) { await stopScreencast(); return { previewStatus: 'private' }; }
      interruption = interrupted();
      if (interruption) { await stopScreencast(); return { previewStatus: interruption }; }
      if (bytes && bytes.length > 500000) return { previewStatus: 'unavailable' };
      return { previewStatus: 'ready', image: streaming ? frame.image : bytes.toString('base64'), capturedAt: streaming ? frame.capturedAt : now() };
    } catch { await stopScreencast(); return { previewStatus: 'unavailable' }; }
    finally { previewing = false; }
  }
  return { ensure, status, isPaused, command, preview, stopScreencast,
    desktopControlValid: body => Boolean(config.desktopEnabled && paused && controlledBy(body)),
    /* Watching, which is the mirror image: it needs the agent to be running,
       not stopped, and refuses while anyone holds the desktop for control. It
       takes no body because an observer commands nothing. */
    desktopObserveValid: () => Boolean(config.desktopEnabled && !paused && !(lease && lease.expiresAt > now())),
    touchDesktopControl: body => {
      if (!config.desktopEnabled || !paused || !controlledBy(body)) return false;
      lease.expiresAt = now() + LEASE_MS; return true;
    },
    onControlChanging: listener => { controlListeners.add(listener); return () => controlListeners.delete(listener); },
  };
}
