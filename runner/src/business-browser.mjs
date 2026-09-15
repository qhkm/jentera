import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = new Set(['Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Delete', 'Escape',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'ControlOrMeta+A']);
const LEASE_MS = 10 * 60 * 1000;
export const BROWSER_VIEWPORT = Object.freeze({ width: 1280, height: 800 });

export class BrowserProblem extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

export function browserCommandProblem(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid_command';
  if (!['claim', 'frame', 'navigate', 'click', 'text', 'key', 'scroll', 'tab', 'release'].includes(body.action)) return 'invalid_command';
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
  if (body.action === 'scroll' && (!Number.isFinite(body.deltaY) || Math.abs(body.deltaY) > 1600)) return 'invalid_scroll';
  if (body.action === 'tab' && (!Number.isInteger(body.index) || body.index < 0 || body.index > 50)) return 'invalid_tab';
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
  let previewing = false;
  let lastPreview = -Infinity;
  let controlRevision = 0;
  let cast = null;
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
    ctx.on('close', () => { if (context === ctx) { context = null; selected = null; } });
  }

  async function persist(value) {
    await fs.mkdir(dirname(config.stateFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(`${config.stateFile}.next`, JSON.stringify({ paused: value }), { mode: 0o600 });
    await fs.rename(`${config.stateFile}.next`, config.stateFile);
    paused = value;
  }
  async function ensure() {
    if (context && context.pages().some((p) => !p.isClosed())) return context;
    if (launching) return launching;
    launching = (async () => {
      const chromium = deps.chromium ?? (await import(config.playwrightEntry)).chromium;
      await fs.mkdir(config.profileDir, { recursive: true, mode: 0o700 });
      // Reattach after a runner restart if the browser survived it.
      try {
        const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 1500 });
        context = browser.contexts()[0];
      } catch {
        context = await chromium.launchPersistentContext(config.profileDir, {
          headless: true, viewport: BROWSER_VIEWPORT,
          // Chromium's CDP HTTP server binds loopback by default. Explicit
          // --remote-debugging-address hangs startup on some Sprite hosts;
          // keep the default and verify the actual bind in the Linux smoke.
          args: ['--remote-debugging-port=9222', '--restore-last-session'],
          timeout: 20000, acceptDownloads: false,
        });
      }
      if (!context) throw new BrowserProblem(503, 'browser_unavailable');
      if (!context.pages().length) await context.newPage();
      context.setDefaultTimeout(5000);
      observeContext(context);
      return context;
    })();
    try { return await launching; } finally { launching = null; }
  }
  function controlledBy(body) {
    return lease && lease.expiresAt > now() && lease.ownerId === body.ownerId && lease.controlId === body.controlId;
  }
  async function status() {
    await loaded;
    return { enabled: true, paused, controlled: Boolean(lease && lease.expiresAt > now()) };
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
      if (body.action === 'claim') {
        if (lease && lease.expiresAt > now() && !controlledBy(body)) throw new BrowserProblem(409, 'browser_controlled');
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
        await persist(false);
        lease = null;
        return status();
      }
      if (!paused || !controlledBy(body)) throw new BrowserProblem(409, 'browser_control_expired');
      /* Idle timeout, not a cap on the session. The lease used to be set at the
         claim and never extended, so control died ten minutes later however
         actively it was being used — and the sign-ins this browser exists for
         run longer than that. The owner lost the screen mid-flow, with a
         half-typed password on it. */
      lease.expiresAt = now() + LEASE_MS;
      const ctx = await ensure();
      const pages = ctx.pages().filter((p) => !p.isClosed());
      const page = selected && !selected.isClosed() ? selected : pages[0];
      if (body.action === 'tab') {
        if (!pages[body.index]) throw new BrowserProblem(400, 'invalid_tab');
        selected = pages[body.index];
      } else if (body.action === 'navigate') {
        await page.goto(body.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } else if (body.action === 'click') await page.mouse.click(body.x, body.y);
      else if (body.action === 'text') await page.keyboard.insertText(body.text);
      else if (body.action === 'key') await page.keyboard.press(body.key);
      else if (body.action === 'scroll') await page.mouse.wheel(0, body.deltaY);
      if (body.action !== 'frame') return { ok: true };
      await page.setViewportSize(BROWSER_VIEWPORT);
      const bytes = await page.screenshot({ type: 'jpeg', quality: 65, timeout: 5000 });
      if (bytes.length > 750000) throw new BrowserProblem(503, 'browser_frame_too_large');
      return {
        image: bytes.toString('base64'), ...BROWSER_VIEWPORT, expiresAt: lease.expiresAt,
        tabs: pages.map((p, index) => {
          let origin = 'Browser';
          try { origin = new URL(p.url()).origin; } catch { /* No internal URL details. */ }
          return { index, origin, selected: p === page };
        }).slice(0, 51),
      };
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
  return { ensure, status, isPaused, command, preview, stopScreencast };
}
