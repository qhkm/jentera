// Requires the isolated Linux runner fixture, workerd transport fixture, and
// qa/vite.config.ts. Fictional credentials only; NEVER a production session.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const origin = 'http://127.0.0.1:3982';
const assertions = async () => (await fetch('http://127.0.0.1:3980/assertions')).json();
const agent = () => fetch('http://127.0.0.1:3980/agent-check');
let available = false;
for (let tries = 0; tries < 100 && !available; tries++) {
  try { available = Boolean((await (await fetch('http://127.0.0.1:3980/api/browser')).json()).enabled); } catch { /* fixture starts slowly */ }
  if (!available) await new Promise(resolve => setTimeout(resolve, 200));
}
assert.ok(available, 'isolated runner fixture is ready');
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.addCookies([{ name: 'fixture-owner', value: '1', url: origin }]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/qa/desktop.html`);
  await page.getByRole('button', { name: 'Open business browser' }).click();
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  // A previous aborted test leaves a paused lease. Recovery is explicit.
  const recovery = page.getByRole('button', { name: 'Use this window', exact: true });
  await Promise.race([page.locator('canvas').waitFor(), recovery.waitFor()]);
  if (await recovery.isVisible()) await recovery.click();
  const canvas = page.locator('.business-desktop-stage canvas');
  await canvas.waitFor();
  await page.getByLabel('Keyboard / paste').waitFor();
  await page.waitForFunction(() => !document.querySelector('.business-desktop-actions input')?.disabled &&
    document.querySelector('canvas')?.width === 1280);
  const migrated = await assertions();
  assert.equal(migrated.headless, false); assert.equal(migrated.cookiePreserved, true);
  assert.equal(migrated.sessionPreserved, true); assert.equal((await agent()).status, 409);
  async function point(id) {
    const state = await assertions(); const box = await canvas.boundingBox();
    const { x, y } = state.geometry[id]; return { x: box.x + x * box.width / 1280, y: box.y + y * box.height / 800 };
  }
  async function click(id) { const position = await point(id); await page.mouse.click(position.x, position.y); await page.waitForTimeout(100); }
  await click('email'); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  await page.keyboard.type('synthetic@example.test', { delay: 15 });
  await click('password'); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  await page.keyboard.type('fictional-only', { delay: 15 });
  await click('notes');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  const proxy = page.getByLabel('Keyboard / paste');
  await proxy.fill('Native paste test');
  await page.waitForTimeout(200);
  let state = await assertions();
  assert.equal(state.email, 'synthetic@example.test'); assert.equal(state.password, 'fictional-only');
  assert.equal(state.notes, 'Native paste test');
  await click('submit'); await page.waitForTimeout(200);
  assert.equal((await assertions()).submitted, 1);
  const start = await point('drag');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 25, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(200); assert.equal((await assertions()).dragged, true);
  await page.screenshot({ path: '/tmp/jentera-desktop-ready.png' });
  console.log('PASS real Chrome/taskbar, saved session migration, native typing/paste, click/drag, agent pause');
  // Fresh membership authentication + lease check every minute, no input replay.
  await page.waitForTimeout(65000);
  await page.waitForFunction(() => !document.querySelector('.business-desktop-actions input')?.disabled);
  state = await assertions(); assert.equal(state.email, 'synthetic@example.test'); assert.equal(state.submitted, 1);
  console.log('PASS authenticated minute renewal without replay');
  await page.getByRole('button', { name: 'Close browser view' }).click();
  assert.equal((await agent()).status, 409);
  await page.getByRole('button', { name: 'Open business browser' }).click();
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await canvas.waitFor(); await page.waitForFunction(() => !document.querySelector('.business-desktop-actions input')?.disabled);
  assert.equal((await assertions()).cookiePreserved, true);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.getByRole('button', { name: 'Hand back to Jentera' }).isVisible(), true);
    await page.screenshot({ path: `/tmp/jentera-desktop-${viewport.width}.png` });
  }
  await page.getByRole('button', { name: 'Hand back to Jentera' }).click();
  await page.waitForFunction(() => !document.querySelector('.business-desktop'));
  assert.equal((await agent()).status, 200);
  assert.equal(await page.getByLabel('Chat draft').inputValue(), 'Keep my unsent draft');
  assert.deepEqual(errors, []);
  console.log('PASS close/reopen stays paused, responsive viewports, explicit hand-back resumes same CDP browser, untouched draft');
} finally { await browser.close(); }
