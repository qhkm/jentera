/* ============================================================
   Web push, the cryptographic half.

   RFC 8291 says how a payload is encrypted so only the browser that
   subscribed can read it: an ECDH agreement with the browser's key,
   HKDF with the browser's auth secret, AES-128-GCM, and a fixed header
   (salt, record size, our public key) in front of the ciphertext.

   RFC 8292 (VAPID) says how the push service knows the message is from
   us: a short ES256 JWT for the service's origin, signed with a key whose
   public half the browser was given when it subscribed.

   Everything here is Web Crypto, which is what a Worker has. The RFC 8291
   worked example is a test, so a change here that still "works" against
   a real browser but drifts from the spec would be caught by a known
   answer rather than by owners who stopped getting notifications.
   ============================================================ */

const te = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

const P256 = { name: 'ECDH', namedCurve: 'P-256' };
/** One record carries the whole message; a payload is a title and a line. */
const RECORD_SIZE = 4096;

export interface PushKeys {
  /** The browser's P-256 public key, uncompressed, base64url. */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

/**
 * Encrypt `payload` for one subscription, returning the aes128gcm body to
 * POST to its endpoint. `serverKeys` and `salt` are only supplied by the
 * RFC 8291 known-answer test; production draws both fresh every time.
 */
export async function encryptPayload(
  payload: string | Uint8Array,
  subscription: PushKeys,
  options: { serverKeys?: CryptoKeyPair; salt?: Uint8Array } = {},
): Promise<Uint8Array> {
  const uaPublicBytes = b64urlDecode(subscription.p256dh);
  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 4) {
    throw new Error('subscription p256dh is not an uncompressed P-256 point');
  }
  const authSecret = b64urlDecode(subscription.auth);
  if (authSecret.length !== 16) throw new Error('subscription auth secret must be 16 bytes');

  const uaPublic = await crypto.subtle.importKey('raw', uaPublicBytes, P256, false, []);
  const serverKeys = options.serverKeys
    ?? (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
  const serverPublicBytes = new Uint8Array((await crypto.subtle.exportKey('raw', serverKeys.publicKey)) as ArrayBuffer);
  /* workers-types spells the peer key `$public`; the runtime, like every
     browser, reads `public`. The cast keeps the standard name. */
  const agreement = { name: 'ECDH', public: uaPublic } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(agreement, serverKeys.privateKey, 256));
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));

  /* RFC 8291 §3.3 and §3.4: the input keying material binds both public
     keys and the auth secret; the content key and nonce come from the salt. */
  const ikm = await hkdf(authSecret, sharedSecret, concat(te.encode('WebPush: info\0'), uaPublicBytes, serverPublicBytes), 32);
  const contentKey = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

  /* RFC 8188: the last (here, only) record ends with the 0x02 delimiter. */
  const plaintext = typeof payload === 'string' ? te.encode(payload) : payload;
  const record = concat(plaintext, new Uint8Array([2]));
  if (record.length + 16 > RECORD_SIZE) throw new Error('push payload does not fit in one record');
  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record),
  );

  const recordSize = new Uint8Array([
    (RECORD_SIZE >>> 24) & 0xff, (RECORD_SIZE >>> 16) & 0xff, (RECORD_SIZE >>> 8) & 0xff, RECORD_SIZE & 0xff,
  ]);
  return concat(salt, recordSize, new Uint8Array([serverPublicBytes.length]), serverPublicBytes, ciphertext);
}

/* ---------- VAPID ---------------------------------------------------- */

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' };
/** RFC 8292 caps a token at 24 hours; half that leaves room for clock skew. */
export const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export interface VapidKeys {
  privateKey: CryptoKey;
  /** The uncompressed public point, base64url: what the browser subscribes with. */
  publicKey: string;
}

/** A fresh P-256 key pair as one JWK string, for `wrangler secret put`. */
export async function generateVapidJwk(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(ES256, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
}

export async function vapidKeysFromJwk(raw: string): Promise<VapidKeys> {
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(raw) as JsonWebKey;
  } catch {
    throw new Error('VAPID_PRIVATE_JWK is not JSON');
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error('VAPID_PRIVATE_JWK must be a P-256 private key in JWK form');
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, ES256, false, ['sign'],
  );
  const publicKey = b64urlEncode(concat(new Uint8Array([4]), b64urlDecode(jwk.x), b64urlDecode(jwk.y)));
  return { privateKey, publicKey };
}

/** The `Authorization` header for one push service, per RFC 8292 §3. */
export async function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  subject: string,
  now: number = Date.now(),
): Promise<string> {
  const header = b64urlEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + VAPID_TOKEN_TTL_SECONDS,
    sub: subject,
  })));
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, te.encode(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}
