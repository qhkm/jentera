// Capture real app components with fictional fixtures, never a production session.
// Start Vite with VITE_API_URL=http://127.0.0.1:5179 pnpm dev --port 5179.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = 'http://127.0.0.1:5179';
const output = fileURLToPath(new URL('../public/images/product-tour/', import.meta.url));
await mkdir(output, { recursive: true });
const runId = '11111111-1111-4111-8111-111111111111';
const approvalRun = '22222222-2222-4222-8222-222222222222';
const date = '2026-09-12T02:00:00Z';
const fact = (key, value, extra = {}) => ({ key, value, source: 'owner', confidence: 1,
  confirmed: true, confirmedAt: date, version: 1, createdAt: date, ...extra });
const work = [
  { id: 'w1', runId, objective: 'Compare three packaging suppliers', outcome: 'Comparison ready. Check delivery costs before choosing a supplier.', status: 'completed' },
  { id: 'w2', runId: approvalRun, objective: 'Prepare the supplier follow-up', outcome: 'Waiting for permission to run the next step.', status: 'needs_approval' },
  { id: 'w3', objective: 'Prepare a weekly stock checklist', outcome: 'Working from the stock notes you shared.', status: 'working' },
].map(w => ({ ...w, occurredAt: date, channel: 'web', canOpen: true }));
const snapshot = {
  onboarded: true, setupDone: true, bizType: 'restaurant', bizName: 'Kedai Contoh · Demo',
  bizLoc: 'Petaling Jaya', channels: [], conns: [], country: 'MY', lang: 'en', theme: 'light',
  approvals: [], permissions: {}, workDone: {}, learn: {}, specialists: [], canManageKnowledge: true,
  facts: [fact('business.name', 'Kedai Contoh'), fact('business.hours', 'Monday–Saturday, 8am–6pm'),
    fact('service.price', 'RM 80', { confirmed: false, confirmedAt: null, source: 'agent', sourceRef: 'sample-menu.txt',
      version: 2, pending: true, currentValue: 'RM 100' })],
};
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1100, height: 1000 },
      deviceScaleFactor: 1, locale: 'en-MY', timezoneId: 'Asia/Kuala_Lumpur', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) {
        return url.origin === origin ? route.continue() : route.abort();
      }
      // The app wakes its runtime on entry. Simulate it here; never forward writes.
      if (url.pathname === '/api/runtime/wake') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      if (url.pathname === '/api/events') return route.fulfill({ status: 204 });
      if (route.request().method() !== 'GET') throw new Error('Capture must not write: ' + url.pathname);
      const path = url.pathname;
      let body;
      if (path === '/api/me') body = { ok: true, userId: 'demo-owner', detailLevel: 'simple', features: {} };
      else if (path === '/api/state') body = { ok: true, snapshot };
      else if (path === '/api/runs/activity') body = { ok: true, work, counters: { completed: 1, needsApproval: 1, minutesSaved: 0, failed: 0 } };
      else if (path === `/api/runs/${runId}`) body = { ok: true, runId, objective: work[0].objective, status: 'completed', pending: false,
        text: 'Three options, compared from the quotes you shared.\n\nSupplier A — RM 0.42 per box. Minimum 500. Delivery in 3–5 days.\nSupplier B — RM 0.38 per box. Minimum 1,000. Delivery in 7 days.\nSupplier C — RM 0.48 per box. Minimum 200. Delivery in 2 days.\n\nFor a small first order, Supplier C has the lowest minimum. Confirm delivery charges and request a sample before ordering.',
        artifacts: [{ id: 'demo-report', name: 'supplier-comparison.csv', mimeType: 'text/csv', size: 428 }] };
      else if (path === `/api/runs/${approvalRun}`) body = { ok: true, runId: approvalRun, objective: work[1].objective,
        status: 'running', taskStatus: 'needs_approval', pending: true, approvalId: 'demo-approval' };
      else if (path === '/api/runtime/approvals/demo-approval') body = { approval: { id: 'demo-approval', tool: 'terminal',
        message: 'python prepare_supplier_followup.py --input supplier-comparison.csv --output supplier-followup.txt', status: 'pending' } };
      else if (path === '/api/agent/memory') body = { ok: true, available: true, profiles: [] };
      else if (path === '/api/connections') body = { ok: true, connections: [] };
      else if (path === '/api/notifications') body = { ok: true, items: [], notifications: [], unread: 0, nextCursor: null };
      else if (path === '/api/workspaces') body = { ok: true, workspaces: [], canManage: true };
      else if (path === '/api/runtime') body = { ok: true, runtime: { status: 'unprovisioned' }, usage: {} };
      else throw new Error('Add an explicit fixture for ' + path);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const scenes = [
      ['result', `/app?view=work&run=${runId}`, '.task-detail', 'supplier-comparison.csv'],
      ['activity', '/app?view=work', '.activity-history', work[0].objective],
      ['approval', `/app?view=work&run=${approvalRun}`, '.ask-approval', 'prepare_supplier_followup.py'],
      ['knowledge', '/app?view=business&tab=knows', '.card:has-text("What Jentera knows")', 'Current confirmed value:'],
    ];
    for (const [name, path, selector, ready] of scenes) {
      await page.goto(origin + path);
      await page.getByText(ready, { exact: false }).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      const target = page.locator(selector).first();
      await target.screenshot({ path: `${output}${name}-${mobile ? 'mobile' : 'desktop'}-v1.png`, animations: 'disabled',
        // Exclude fixed navigation overlapping the cropped component; content is unchanged.
        style: '.dashboard-bottom-nav { visibility: hidden !important; }' });
      console.log('Captured ' + name + (mobile ? ' mobile' : ' desktop'));
    }
    if (errors.length) throw new Error(errors.join('\n'));
    await context.close();
  }
} finally { await browser.close(); }
