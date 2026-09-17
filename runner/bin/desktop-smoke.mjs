// Bootstrap proof against an isolated temporary profile/display, never 9222,
// never a business profile. No model calls or screenshots are written.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const gateway = new URL('./desktop-gateway.mjs', import.meta.url);
const { openDesktop } = await import(existsSync(gateway) ? gateway : new URL('../src/desktop-gateway.mjs', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_ENTRY);
const dir = await mkdtemp(join(tmpdir(), 'jentera-desktop-smoke-'));
let context;
let desktop;
try {
  context = await chromium.launchPersistentContext(join(dir, 'profile'), {
    headless: false, viewport: null, chromiumSandbox: true,
    args: ['--window-size=1280,800', '--start-maximized'],
    ...(process.env.DESKTOP_SMOKE_CHROMIUM ? { executablePath: process.env.DESKTOP_SMOKE_CHROMIUM } : {}),
  });
  await context.pages()[0].setContent('<h1>Jentera isolated desktop readiness</h1>');
  desktop = await openDesktop({ display: process.env.DISPLAY, socketPath: join(dir, 'desktop.sock') });
  let buffer = Buffer.alloc(0);
  const waiters = new Set();
  let failed = false;
  const wake = () => { for (const notify of waiters) notify(); };
  desktop.stream.on('data', bytes => {
    if (buffer.length + bytes.length > 128 * 1024) { failed = true; desktop.stream.destroy(); }
    else buffer = Buffer.concat([buffer, bytes]);
    wake();
  });
  desktop.stream.on('error', () => { failed = true; wake(); });
  desktop.stream.on('close', () => { failed = true; wake(); });
  async function read(length) {
    assert.ok(length <= 65536, 'bounded RFB readiness data');
    const deadline = Date.now() + 8000;
    while (buffer.length < length) {
      if (failed || Date.now() >= deadline) throw new Error('Desktop readiness unavailable');
      await new Promise(resolve => {
        let timer;
        const notify = () => { clearTimeout(timer); waiters.delete(notify); resolve(); };
        waiters.add(notify); timer = setTimeout(notify, Math.max(1, deadline - Date.now()));
      });
    }
    const bytes = buffer.subarray(0, length); buffer = buffer.subarray(length); return bytes;
  }
  assert.match((await read(12)).toString(), /^RFB 003\.008\n$/);
  desktop.stream.write('RFB 003.008\n');
  const count = (await read(1))[0];
  assert.ok((await read(count)).includes(1), 'private socket supports no-password RFB');
  desktop.stream.write(Buffer.from([1]));
  assert.equal((await read(4)).readUInt32BE(), 0);
  desktop.stream.write(Buffer.from([1]));
  const header = await read(24);
  assert.ok(header.readUInt16BE(0) >= 1000 && header.readUInt16BE(2) >= 700, 'actual X11 framebuffer available');
  await read(header.readUInt32BE(20));
  desktop.stream.destroy(); await desktop.stop(); desktop = null;
  process.stdout.write('{"ok":true,"desktop":"x11-vnc"}\n');
} finally {
  desktop?.stream.destroy(); await desktop?.stop(); await context?.close();
  await rm(dir, { recursive: true, force: true });
}
