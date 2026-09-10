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
  const loaded = (async () => {
    try {
      const saved = JSON.parse(await fs.readFile(config.stateFile, 'utf8'));
      paused = saved.paused !== false;
    } catch (error) {
      if (error.code === 'ENOENT') paused = false;
    }
  })();

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
          args: ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1', '--restore-last-session'],
          timeout: 20000, acceptDownloads: false,
        });
      }
      if (!context) throw new BrowserProblem(503, 'browser_unavailable');
      if (!context.pages().length) await context.newPage();
      context.setDefaultTimeout(5000);
      context.on('page', (page) => { selected = page; });
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
    busy = true;
    try {
      if (body.action === 'claim') {
        if (lease && lease.expiresAt > now() && !controlledBy(body)) throw new BrowserProblem(409, 'browser_controlled');
        await persist(true);
        lease = { ownerId: body.ownerId, controlId: body.controlId, expiresAt: now() + LEASE_MS };
        await ensure();
        return { ...(await status()), expiresAt: lease.expiresAt };
      }
      if (!paused || !controlledBy(body)) throw new BrowserProblem(409, 'browser_control_expired');
      if (body.action === 'release') {
        await persist(false);
        lease = null;
        return status();
      }
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
  return { ensure, status, isPaused, command };
}
