// Fictional, offline integration fixture. These endpoints are NEVER shipped.
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ws from '../../../app/node_modules/ws/index.js';
import { chromium } from '../../../app/node_modules/playwright/index.mjs';
import { createBusinessBrowser, desktopBrowserArguments } from '../../src/business-browser.mjs';
import { createDesktopGateway } from '../../src/desktop-gateway.mjs';

const businessId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const runnerKey = 'isolated-desktop-runner-key-'.repeat(2);
const dir = await mkdtemp(join(tmpdir(), 'jentera-desktop-fixture-'));
let browser;
let context;
const html = `<!doctype html><title>Jentera desktop test</title><style>body{font:18px system-ui;margin:40px;background:#f5faf7;color:#163d30}input,button{font:18px system-ui;margin:10px;padding:12px}textarea{display:block;margin:10px;padding:12px;width:500px;height:120px}#drag{width:80px;height:60px;background:#00c493;position:absolute;left:650px;top:180px;touch-action:none}</style>
  <h1>Real Chrome · isolated business desktop</h1><label>Email<input id="email"></label><label>Password<input id="password" type="password"></label>
  <button id="submit" onclick="window.submitted=(window.submitted||0)+1">Submit</button><textarea id="notes"></textarea><div id="drag"></div>
  <script>drag.onpointerdown=e=>{drag.setPointerCapture(e.pointerId);window.dragged=false};drag.onpointermove=e=>{if(e.buttons){drag.style.left=e.clientX+'px';window.dragged=true}};</script>`;
const http = createServer(async (req, res) => {
  try {
    if (req.url === '/demo') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (req.url === '/api/browser') {
      if (!browser) { res.writeHead(503); res.end('{"err":"Fixture starting"}'); return; }
      let value;
      if (req.method === 'POST') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        value = await browser.command({ ...JSON.parse(raw), ownerId });
      } else value = await browser.status();
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return;
    }
    if (req.url === '/assertions') {
      const current = await browser.ensure(); const page = current.pages().find(p => p.url().endsWith('/demo'));
      const session = await current.browser().newBrowserCDPSession();
      let args;
      try { ({ arguments: args } = await session.send('Browser.getBrowserCommandLine')); }
      catch { args = await desktopBrowserArguments(); }
      await session.detach();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ paused: await browser.isPaused(), headless: args.some(arg => arg.startsWith('--headless')),
        cookiePreserved: (await current.cookies()).some(cookie => cookie.name === 'synthetic-session' && cookie.value === 'kept'),
        sessionPreserved: await page.evaluate(() => localStorage.getItem('synthetic-session') === 'kept'),
        email: await page.locator('#email').inputValue(), password: await page.locator('#password').inputValue(),
        notes: await page.locator('#notes').inputValue(), submitted: await page.evaluate(() => window.submitted || 0),
        dragged: await page.evaluate(() => Boolean(window.dragged)),
        geometry: await page.evaluate(() => Object.fromEntries(['email', 'password', 'notes', 'drag', 'submit'].map(id => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return [id, { x: window.screenX + rect.x + rect.width / 2,
            y: window.screenY + window.outerHeight - window.innerHeight + rect.y + rect.height / 2 }];
        }))),
      })); return;
    }
    if (req.url === '/agent-check') {
      if (await browser.isPaused()) { res.writeHead(409); res.end(); return; }
      const agent = await chromium.connectOverCDP('http://127.0.0.1:9222');
      const page = agent.contexts()[0].pages().find(p => p.url().endsWith('/demo'));
      await page.evaluate(() => document.body.dataset.agent = 'handed-back');
      res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return;
    }
    res.writeHead(404); res.end();
  } catch (error) {
    console.error('Isolated fixture error:', error.stack);
    res.writeHead(error.status ?? 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ err: error.status === 409 ? 'Another window is controlling this browser.' : 'Fixture unavailable' }));
  }
});
const wss = new ws.WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
http.on('upgrade', (req, socket, head) => {
  if (req.url !== '/sprites/test/proxy' || req.headers.authorization !== 'Bearer isolated-sprites-token') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    let tcp;
    let initialized = false;
    ws.on('error', () => {});
    ws.once('close', () => tcp?.destroy());
    ws.on('message', (data, binary) => {
      if (!initialized) {
        let init; try { init = JSON.parse(data.toString()); } catch { ws.close(); return; }
        if (binary || init.host !== 'localhost' || init.port !== 5901) { ws.close(); return; }
        initialized = true;
        tcp = connect(5901, '127.0.0.1'); tcp.on('error', () => ws.close()); tcp.once('close', () => ws.close());
        tcp.once('connect', () => ws.send('{"status":"connected","target":"localhost:5901"}'));
        tcp.on('data', bytes => ws.send(bytes, { binary: true }));
      } else if (binary) tcp.write(data); else ws.close();
    });
  });
});
await new Promise(resolve => http.listen(3980, '0.0.0.0', resolve));
// Start headless on the SAME synthetic persistent profile to prove migration.
const profileDir = join(dir, 'profile');
context = await chromium.launchPersistentContext(profileDir, { headless: true,
  executablePath: '/usr/bin/chromium', args: ['--remote-debugging-port=9222', '--restore-last-session'] });
const page = context.pages()[0]; await page.goto('http://127.0.0.1:3980/demo');
await context.addCookies([{ name: 'synthetic-session', value: 'kept', url: 'http://127.0.0.1:3980' }]);
await page.evaluate(() => localStorage.setItem('synthetic-session', 'kept'));
browser = createBusinessBrowser({ stateFile: join(dir, 'control.json'), profileDir, desktopEnabled: true }, {
  chromium: { connectOverCDP: (...args) => chromium.connectOverCDP(...args), launchPersistentContext: async (profile, options) => {
    context = await chromium.launchPersistentContext(profile, { ...options, executablePath: '/usr/bin/chromium' }); return context;
  } },
});
const gateway = createDesktopGateway({ businessId, runnerKey, browser, display: process.env.DISPLAY,
  socketPath: join(dir, 'desktop.sock') });
gateway.listen(5901, '127.0.0.1');
process.stdout.write('Isolated desktop fixture ready\n');
