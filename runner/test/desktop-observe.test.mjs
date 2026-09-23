import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { createDesktopGateway, desktopTicketValid, desktopObserveTicketValid,
  desktopArgs, DESKTOP_TTL_MS } from '../src/desktop-gateway.mjs';

/* An observe session watches the agent work. It injects nothing, so it needs
   neither the durable pause nor a control lease — and because nothing is
   injected there are no held keys to release, so it can never latch the
   cleanup guard that hides the desktop until a runner restart.
   `docs/plans/2026-09-23-desktop-observe.md` is the contract. */

const businessId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const controlId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const runnerKey = 'isolated-desktop-runner-key-'.repeat(2);

function sign(payload) {
  return { ...payload, signature: createHmac('sha256', runnerKey).update(JSON.stringify(payload)).digest('hex') };
}
function observeTicket(extra = {}, now = Date.now()) {
  return sign({ purpose: 'jentera-desktop-observe-v1', businessId, ownerId, runId,
    nonce: randomUUID(), issuedAt: now, expiresAt: now + DESKTOP_TTL_MS, ...extra });
}
function controlTicket(extra = {}, now = Date.now()) {
  return sign({ purpose: 'jentera-desktop-v1', businessId, ownerId, controlId,
    nonce: randomUUID(), issuedAt: now, expiresAt: now + DESKTOP_TTL_MS, ...extra });
}

async function fixture(t, { paused = false } = {}) {
  let lease = { ownerId, controlId };
  let live = paused;
  const changes = new Set();
  const input = [];
  const options = [];
  let releases = 0;
  const vnc = createServer(socket => {
    socket.on('error', () => {});
    socket.write('RFB 003.008\n'); socket.on('data', bytes => input.push(bytes));
  });
  vnc.listen(0, '127.0.0.1'); await once(vnc, 'listening');
  const browser = {
    desktopControlValid: ticket => live && ticket.ownerId === lease.ownerId && ticket.controlId === lease.controlId,
    touchDesktopControl: () => true,
    desktopObserveValid: () => !live,
    onControlChanging: listener => { changes.add(listener); return () => changes.delete(listener); },
  };
  const gateway = createDesktopGateway({ browser, businessId, runnerKey }, { openDesktop: async (opts = {}) => {
    options.push(opts);
    const stream = connect(vnc.address().port, '127.0.0.1'); await once(stream, 'connect');
    return { stream, done: once(stream, 'close'),
      stop: async () => { if (!opts.viewOnly) releases++; stream.destroy(); } };
  } });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  t.after(async () => { await gateway.closeDesktop().catch(() => {}); await new Promise(resolve => vnc.close(resolve)); });
  async function client(ticket) {
    const socket = connect(gateway.address().port, '127.0.0.1');
    socket.setNoDelay(true); socket.on('error', () => {});
    const closed = new Promise(resolve => socket.once('close', resolve));
    const data = []; socket.on('data', bytes => data.push(bytes));
    await once(socket, 'connect'); socket.write(`${JSON.stringify(ticket)}\n`);
    return { socket, closed, data };
  }
  async function ready(c) {
    for (let tries = 0; tries < 100 && !Buffer.concat(c.data).includes('RFB'); tries++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.match(Buffer.concat(c.data).toString(), /^\{"ok":true\}\nRFB 003\.008\n/);
  }
  return { client, ready, input, options, releases: () => releases, gateway,
    takeControl: async () => { live = true; for (const listener of changes) await listener(); } };
}

test('an observe ticket is a different thing from a control ticket, both ways', () => {
  const now = Date.now();
  const config = { businessId, runnerKey };
  assert.ok(desktopObserveTicketValid(observeTicket({}, now), config, now));
  assert.ok(desktopTicketValid(controlTicket({}, now), config, now));

  // Neither validator accepts the other's ticket. The purpose is inside the
  // signed payload, so this cannot be reached by editing a field in flight.
  assert.equal(desktopObserveTicketValid(controlTicket({}, now), config, now), false);
  assert.equal(desktopTicketValid(observeTicket({}, now), config, now), false);

  for (const change of [{ purpose: 'jentera-desktop-v1' }, { businessId: ownerId }, { runId: 'invalid' },
    { ownerId: 'invalid' }, { expiresAt: now - 1 }, { expiresAt: now + DESKTOP_TTL_MS + 1 },
    { issuedAt: now + 10000 }, { signature: '0'.repeat(64) }]) {
    assert.equal(desktopObserveTicketValid({ ...observeTicket({}, now), ...change }, config, now), false,
      `should refuse ${JSON.stringify(change)}`);
  }
  // A control lease has no meaning here; carrying one is a malformed ticket.
  assert.equal(desktopObserveTicketValid(observeTicket({ controlId }, now), config, now), false);
});

test('x11vnc is told to ignore input for an observe session', () => {
  const watching = desktopArgs({ display: ':99', socketPath: '/tmp/d.sock', viewOnly: true });
  const controlling = desktopArgs({ display: ':99', socketPath: '/tmp/d.sock' });
  // Enforced by x11vnc itself, not by the gateway declining to forward.
  assert.ok(watching.includes('-viewonly'));
  assert.ok(!controlling.includes('-viewonly'));
  for (const shared of ['-unixsock', '-nopw', '-noremote', '-noclipboard', '-clear_keys']) {
    assert.ok(watching.includes(shared), `observe must keep ${shared}`);
    assert.ok(controlling.includes(shared), `control must keep ${shared}`);
  }
});

test('an observe session runs while the agent works — no pause, no lease', async t => {
  const f = await fixture(t, { paused: false });
  const c = await f.client(observeTicket());
  await f.ready(c);
  assert.equal(f.options.length, 1);
  assert.equal(f.options[0].viewOnly, true);
});

test('nothing an observer types reaches the desktop', async t => {
  const f = await fixture(t);
  const c = await f.client(observeTicket());
  await f.ready(c);
  c.socket.write('synthetic-input');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(Buffer.concat(f.input).length, 0);
});

test('observing stops when the owner takes control, and is refused while they hold it', async t => {
  const f = await fixture(t);
  const watching = await f.client(observeTicket());
  await f.ready(watching);
  await f.takeControl();
  await watching.closed;
  const refused = await f.client(observeTicket());
  await refused.closed;
  assert.equal(refused.data.length, 0);
});

test('a control ticket still needs the pause and the lease', async t => {
  const f = await fixture(t, { paused: false });
  const refused = await f.client(controlTicket());
  await refused.closed;
  assert.equal(refused.data.length, 0);
});

test('an observe session never runs the native key release, so it cannot latch cleanup', async t => {
  const f = await fixture(t);
  const c = await f.client(observeTicket());
  await f.ready(c);
  c.socket.destroy();
  await c.closed;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(f.releases(), 0);
  assert.equal(f.gateway.desktopReady(), true);
});
