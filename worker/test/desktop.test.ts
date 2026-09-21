import { afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { DESKTOP_TTL_MS, desktopControlProtocol, desktopEnabledFor, desktopTicket } from '../src/runtime/desktop';
import { bridgeSpritesDesktop } from '../src/routes/browser-desktop';
import type { Env } from '../src/env';

const businessId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const controlId = '33333333-3333-4333-8333-333333333333';
const runnerKey = 'synthetic-desktop-runner-key';
afterEach(() => vi.useRealTimers());

it('requires both the exact flag and a strict limited business allowlist', () => {
  for (const config of [{}, { DESKTOP_VIEW_ENABLED: 'true' }, { DESKTOP_VIEW_ENABLED: '1', DESKTOP_VIEW_BUSINESS_IDS: businessId },
    { DESKTOP_VIEW_ENABLED: 'true', DESKTOP_VIEW_BUSINESS_IDS: '*' }, { DESKTOP_VIEW_ENABLED: 'true', DESKTOP_VIEW_BUSINESS_IDS: `${businessId},invalid` }]) {
    expect(desktopEnabledFor(config as Env, businessId)).toBe(false);
  }
  expect(desktopEnabledFor({ DESKTOP_VIEW_ENABLED: 'true', DESKTOP_VIEW_BUSINESS_IDS: businessId } as Env, businessId)).toBe(true);
  expect(desktopEnabledFor({ DESKTOP_VIEW_ENABLED: 'true', DESKTOP_VIEW_BUSINESS_IDS: ownerId } as Env, businessId)).toBe(false);
});

it('selects only a UUID window lease from the bounded protocol, never a URL/credential', () => {
  expect(desktopControlProtocol(`binary, jentera-control.${controlId}`)).toBe(controlId);
  for (const protocol of [null, '', 'binary', `jentera-control.${controlId},binary`, `binary, jentera-control.${controlId},evil`, 'binary, jentera-control.secret']) {
    expect(desktopControlProtocol(protocol)).toBeNull();
  }
});

it('issues interoperable HMAC tickets with purpose, server identity, random nonce and ten-minute expiry', async () => {
  const ticket = await desktopTicket(runnerKey, businessId, ownerId, controlId);
  const { signature, ...payload } = ticket;
  expect(signature).toBe(createHmac('sha256', runnerKey).update(JSON.stringify(payload)).digest('hex'));
  expect(ticket).toMatchObject({ purpose: 'jentera-desktop-v1', businessId, ownerId, controlId });
  expect(ticket.expiresAt - ticket.issuedAt).toBe(DESKTOP_TTL_MS);
  expect((await desktopTicket(runnerKey, businessId, ownerId, controlId)).nonce).not.toBe(ticket.nonce);
});

class Socket extends EventTarget {
  sent: (string | ArrayBuffer | ArrayBufferView)[] = [];
  closed = false;
  accept() { /* fixture */ }
  send(data: string | ArrayBuffer | ArrayBufferView) { this.sent.push(data); }
  close() { this.closed = true; }
  message(data: string | ArrayBuffer) { this.dispatchEvent(new MessageEvent('message', { data })); }
  socket() { return this as unknown as WebSocket; }
}
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

it('consumes both private handshakes and relays only binary RFB bytes', async () => {
  const upstream = new Socket(); const client = new Socket();
  const ticket = await desktopTicket(runnerKey, businessId, ownerId, controlId);
  const ready = bridgeSpritesDesktop(upstream.socket(), client.socket(), ticket);
  expect(upstream.socket().binaryType).toBe('arraybuffer');
  expect(client.socket().binaryType).toBe('arraybuffer');
  expect(upstream.sent[0]).toBe('{"host":"localhost","port":5901}');
  upstream.message('{"status":"connected","target":"localhost:5901"}');
  expect(new TextDecoder().decode(upstream.sent[1] as Uint8Array)).toBe(`${JSON.stringify(ticket)}\n`);
  upstream.message(bytes('{"ok":true}\nRFB 003.008\n')); await ready;
  expect(new TextDecoder().decode(client.sent[0] as Uint8Array)).toBe('RFB 003.008\n');
  expect(client.sent).toHaveLength(1);
  client.message(bytes('synthetic-key')); expect(new TextDecoder().decode(upstream.sent[2] as Uint8Array)).toBe('synthetic-key');
  upstream.dispatchEvent(new Event('close')); expect(client.closed).toBe(true);
});

it('accepts Sprites resolved-target metadata because the requested destination is fixed server-side', async () => {
  const upstream = new Socket(); const client = new Socket();
  const ticket = await desktopTicket(runnerKey, businessId, ownerId, controlId);
  const ready = bridgeSpritesDesktop(upstream.socket(), client.socket(), ticket);
  upstream.message('{"status":"connected","target":"127.0.0.1:5901"}');
  upstream.message(bytes('{"ok":true}\nRFB 003.008\n')); await ready;
  expect(new TextDecoder().decode(client.sent[0] as Uint8Array)).toBe('RFB 003.008\n');
});

it('refuses input before authentication, failed proxy status and malformed prefacing data', async () => {
  for (const attack of ['early-input', 'failed-proxy', 'wrong-lease', 'huge']) {
    const upstream = new Socket(); const client = new Socket();
    const ready = bridgeSpritesDesktop(upstream.socket(), client.socket(), await desktopTicket(runnerKey, businessId, ownerId, controlId));
    const rejected = expect(ready).rejects.toThrow('Desktop unavailable');
    if (attack === 'early-input') client.message(bytes('key'));
    else if (attack === 'failed-proxy') upstream.message('{"status":"error","target":"localhost:5901"}');
    else if (attack === 'huge') upstream.message('x'.repeat(257));
    else { upstream.message('{"status":"connected","target":"localhost:5901"}'); upstream.message(bytes('{"ok":false}\nprivate')); }
    await rejected; expect(client.closed).toBe(true); expect(upstream.closed).toBe(true); expect(client.sent).toHaveLength(0);
  }
});

it('bounds handshake lifetime, session lifetime and binary input size', async () => {
  vi.useFakeTimers();
  const upstream = new Socket(); const client = new Socket();
  const pending = bridgeSpritesDesktop(upstream.socket(), client.socket(), await desktopTicket(runnerKey, businessId, ownerId, controlId));
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(8001); await rejected; expect(client.closed).toBe(true);
  const next = new Socket(); const owner = new Socket();
  const ready = bridgeSpritesDesktop(next.socket(), owner.socket(), await desktopTicket(runnerKey, businessId, ownerId, controlId));
  next.message('{"status":"connected","target":"localhost:5901"}'); next.message(bytes('{"ok":true}\n')); await ready;
  await vi.advanceTimersByTimeAsync(DESKTOP_TTL_MS + 1); expect(owner.closed).toBe(true);
});

it('bounds each second of admitted output instead of imposing a normal-session lifetime byte cap', async () => {
  const upstream = new Socket(); const client = new Socket();
  const ready = bridgeSpritesDesktop(upstream.socket(), client.socket(), await desktopTicket(runnerKey, businessId, ownerId, controlId));
  upstream.message('{"status":"connected","target":"localhost:5901"}'); upstream.message(bytes('{"ok":true}\n')); await ready;
  for (let frame = 0; frame < 40 && !client.closed; frame++) upstream.message(new ArrayBuffer(256 * 1024));
  expect(client.closed).toBe(true); expect(upstream.closed).toBe(true);
  expect(client.sent.length).toBeLessThanOrEqual(32);
});
