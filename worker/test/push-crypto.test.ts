import { describe, expect, it } from 'vitest';
import {
  encryptPayload,
  generateVapidJwk,
  vapidAuthorization,
  vapidKeysFromJwk,
} from '../src/push/crypto';

const b64url = {
  decode(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  },
  encode(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
};

/* RFC 8291, Appendix A: every input is given, so the ciphertext is a known
   answer rather than something this code agrees with itself about. */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  serverPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function rfcServerKeys(): Promise<CryptoKeyPair> {
  const pub = b64url.decode(RFC.serverPublic);
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64url.encode(pub.slice(1, 33)), y: b64url.encode(pub.slice(33, 65)), d: RFC.serverPrivate,
  };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const { d: _d, ...publicJwk } = jwk;
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey };
}

describe('web push payload encryption (RFC 8291, aes128gcm)', () => {
  it('reproduces the RFC 8291 worked example byte for byte', async () => {
    const body = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, {
      serverKeys: await rfcServerKeys(),
      salt: b64url.decode(RFC.salt),
    });
    expect(b64url.encode(body)).toBe(RFC.body);
  });

  it('uses fresh keys and salt every time when none are supplied', async () => {
    const subscription = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const first = await encryptPayload('hello', subscription);
    const second = await encryptPayload('hello', subscription);
    expect(first.length).toBe(second.length);
    expect(b64url.encode(first)).not.toBe(b64url.encode(second));
    /* salt(16) rs(4) idlen(1) key(65) then ciphertext of "hello" + 0x02 + 16-byte tag */
    expect(first.length).toBe(16 + 4 + 1 + 65 + 'hello'.length + 1 + 16);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a token the push service can verify with the advertised public key', async () => {
    const jwk = await generateVapidJwk();
    const keys = await vapidKeysFromJwk(jwk);
    expect(keys.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);

    const now = Date.UTC(2026, 8, 12, 10, 0, 0);
    const header = await vapidAuthorization(keys, 'https://fcm.googleapis.com/fcm/send/abc', 'mailto:admin@kitakodventures.com', now);
    const match = /^vapid t=([^,]+), k=([^,]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, token, k] = match!;
    expect(k).toBe(keys.publicKey);

    const [h, c, s] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64url.decode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(new TextDecoder().decode(b64url.decode(c)));
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:admin@kitakodventures.com' });
    expect(claims.exp).toBe(Math.floor(now / 1000) + 12 * 60 * 60);

    const pub = b64url.decode(k);
    const publicKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', x: b64url.encode(pub.slice(1, 33)), y: b64url.encode(pub.slice(33, 65)),
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64url.decode(s), new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it('rejects a key that is not a P-256 private key', async () => {
    await expect(vapidKeysFromJwk(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }))).rejects.toThrow();
    await expect(vapidKeysFromJwk('not json')).rejects.toThrow();
  });
});
