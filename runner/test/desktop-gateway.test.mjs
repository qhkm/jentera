import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { createDesktopGateway, desktopTicketValid } from '../src/desktop-gateway.mjs';

const businessId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const controlId = '33333333-3333-4333-8333-333333333333';
const runnerKey = 'isolated-desktop-runner-key-'.repeat(2);
function signed(extra = {}, now = Date.now()) {
  const payload = { purpose: 'jentera-desktop-v1', businessId, ownerId, controlId,
    nonce: randomUUID(), issuedAt: now, expiresAt: now + 60000, ...extra };
  return { ...payload, signature: createHmac('sha256', runnerKey).update(JSON.stringify(payload)).digest('hex') };
}
async function fixture(t, { failCleanup = false, launchDelay = 0 } = {}) {
  let lease = { ownerId, controlId };
  let paused = true;
  const changes = new Set();
  const input = [];
  let launches = 0;
  let stops = 0;
  const vnc = createServer(socket => {
    socket.on('error', () => {});
    socket.write('RFB 003.008\n'); socket.on('data', bytes => input.push(bytes));
  });
  vnc.listen(0, '127.0.0.1'); await once(vnc, 'listening');
  const browser = {
    desktopControlValid: ticket => paused && ticket.ownerId === lease.ownerId && ticket.controlId === lease.controlId,
    touchDesktopControl: () => true,
    onControlChanging: listener => { changes.add(listener); return () => changes.delete(listener); },
  };
  const gateway = createDesktopGateway({ browser, businessId, runnerKey }, { openDesktop: async () => {
    launches++;
    if (launchDelay) await new Promise(resolve => setTimeout(resolve, launchDelay));
    const stream = connect(vnc.address().port, '127.0.0.1'); await once(stream, 'connect');
    return { stream, done: once(stream, 'close'), stop: async () => { stops++; stream.destroy(); if (failCleanup) throw new Error('synthetic cleanup failure'); } };
  } });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  t.after(async () => { await gateway.closeDesktop().catch(() => {}); await new Promise(resolve => vnc.close(resolve)); });
  async function client(ticket = signed()) {
    const socket = connect(gateway.address().port, '127.0.0.1');
    socket.setNoDelay(true); socket.on('error', () => {});
    const closed = new Promise(resolve => socket.once('close', resolve));
    const data = []; socket.on('data', bytes => data.push(bytes));
    await once(socket, 'connect'); socket.write(`${JSON.stringify(ticket)}\n`);
    return { socket, closed, data };
  }
  async function ready(client) {
    for (let tries = 0; tries < 100 && !Buffer.concat(client.data).includes('RFB'); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.match(Buffer.concat(client.data).toString(), /^\{"ok":true\}\nRFB 003\.008\n/);
  }
  return { client, ready, input, launches: () => launches, stops: () => stops,
    change: async (next, resume = false) => { for (const listener of changes) await listener(); lease = next; if (resume) paused = false; },
    expire: () => { paused = false; },
  };
}

test('desktop tickets bind purpose, business, owner/window, nonce and short expiration', () => {
  assert.ok(desktopTicketValid(signed(), { businessId, runnerKey }));
  for (const change of [{ purpose: 'run' }, { businessId: ownerId }, { expiresAt: Date.now() - 1 },
    { expiresAt: Date.now() + 100000 }, { ownerId: 'invalid' }, { issuedAt: Date.now() + 10000 }, { signature: '0'.repeat(64) }]) {
    assert.equal(desktopTicketValid({ ...signed(), ...change }, { businessId, runnerKey }), false);
  }
});

test('unauthenticated, stale, wrong-owner/window, tampered and replayed connections never see pixels', async t => {
  const f = await fixture(t);
  for (const ticket of [signed({ ownerId: businessId }), signed({ controlId: businessId }), signed({ expiresAt: Date.now() - 1 }),
    { ...signed(), signature: '0'.repeat(64) }, { command: 'shell' }]) {
    const c = await f.client(ticket); await c.closed; assert.equal(c.data.length, 0);
  }
  assert.equal(f.launches(), 0);
  const ticket = signed(); const c = await f.client(ticket); await f.ready(c);
  c.socket.destroy(); await c.closed; await new Promise(resolve => setTimeout(resolve, 20));
  const replay = await f.client(ticket); await replay.closed; assert.equal(replay.data.length, 0); assert.equal(f.launches(), 1);
});

test('only one viewer is allowed; explicit recovery closes old input before new control takes effect', async t => {
  const f = await fixture(t);
  const old = await f.client(); await f.ready(old);
  const concurrent = await f.client(); await concurrent.closed; assert.equal(concurrent.data.length, 0);
  old.socket.write('synthetic-input'); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(Buffer.concat(f.input).toString(), 'synthetic-input');
  const nextControl = randomUUID(); await f.change({ ownerId, controlId: nextControl }); await old.closed;
  const stale = await f.client(); await stale.closed; assert.equal(stale.data.length, 0);
  const current = await f.client(signed({ controlId: nextControl })); await f.ready(current);
  await f.change({ ownerId, controlId: nextControl }, true); await current.closed;
  const resumed = await f.client(signed({ controlId: nextControl })); await resumed.closed; assert.equal(resumed.data.length, 0);
});

test('expiration closes the stream and prevents late native input', async t => {
  const f = await fixture(t); const c = await f.client(signed({ expiresAt: Date.now() + 150 }));
  await f.ready(c); await c.closed; assert.equal(f.input.length, 0);
});

test('a client disconnecting during native startup cleans up once without killing its replacement viewer', async t => {
  const f = await fixture(t, { launchDelay: 100 });
  const old = await f.client();
  for (let tries = 0; tries < 100 && f.launches() === 0; tries++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.launches(), 1);
  old.socket.destroy(); await old.closed;
  await new Promise(resolve => setTimeout(resolve, 10));
  const current = await f.client(); await f.ready(current);
  assert.equal(f.stops(), 1);
  current.socket.write('replacement-input');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(Buffer.concat(f.input).toString(), 'replacement-input');
  assert.equal(current.socket.destroyed, false);
});

test('failed native cleanup refuses hand-back and subsequent desktop connections', async t => {
  const f = await fixture(t, { failCleanup: true }); const c = await f.client(); await f.ready(c);
  await assert.rejects(f.change({ ownerId, controlId }, true), /cleanup unavailable/);
  await c.closed;
  const next = await f.client(); await next.closed; assert.equal(next.data.length, 0);
});

test('oversized prefaces and input floods are disconnected', async t => {
  const f = await fixture(t); const bad = await f.client({ input: 'x'.repeat(2000) }); await bad.closed;
  assert.equal(f.launches(), 0);
  const c = await f.client(); await f.ready(c); c.socket.write(Buffer.alloc(300 * 1024)); await c.closed;
  assert.ok(Buffer.concat(f.input).length <= 256 * 1024);
});
