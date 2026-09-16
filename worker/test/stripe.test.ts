import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from '../src/stripe';

const SECRET = 'whsec_test_secret';

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(secret: string, payload: string, ts = Math.floor(Date.now() / 1000)): Promise<string> {
  const sig = await hmacHex(secret, `${ts}.${payload}`);
  return `t=${ts},v1=${sig}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a valid signature', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const signature = await sign(SECRET, payload);
    expect(await verifyStripeSignature(payload, signature, SECRET)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const signature = await sign(SECRET, payload);
    expect(await verifyStripeSignature(`${payload}x`, signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const signature = await sign(SECRET, payload);
    expect(await verifyStripeSignature(payload, signature, 'whsec_wrong')).toBe(false);
  });

  it('rejects a timestamp outside tolerance', async () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const signature = await sign(SECRET, payload, Math.floor(Date.now() / 1000) - 1000);
    expect(await verifyStripeSignature(payload, signature, SECRET)).toBe(false);
  });

  it('rejects a missing signature header', async () => {
    expect(await verifyStripeSignature('{}', null, SECRET)).toBe(false);
  });

  it('rejects a malformed header', async () => {
    expect(await verifyStripeSignature('{}', 'garbage', SECRET)).toBe(false);
  });
});
