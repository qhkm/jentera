/* ============================================================
   The credential vault.

   Business owners paste their own bot tokens into the product, so the
   database holds other people's secrets. Encrypted at rest with a key
   the database never sees: a dump is then worth nothing without the
   Worker's key, and the Worker's key is worth nothing without a dump.

   AES-GCM rather than AES-CBC because it authenticates as well as
   encrypts — a tampered ciphertext fails to decrypt rather than
   yielding plausible garbage that gets sent to Telegram as a token.
   ============================================================ */

import type { Env } from './env';

/** Bumped when the key changes. Old rows keep their own version and
    stay readable, so a key can be retired without a flag day. */
export const KEY_VERSION = 1;

const IV_BYTES = 12;

async function keyFor(env: Env, version: number): Promise<CryptoKey> {
  const raw = version === KEY_VERSION ? env.CREDENTIAL_KEY : undefined;
  if (!raw) {
    throw new Error(`no credential key for version ${version}`);
  }
  /* The secret is 32 random bytes, base64. Hashing whatever arrives
     would accept a short or low-entropy value silently; requiring the
     real length means a misconfigured key fails loudly at startup
     rather than quietly weakening every credential. */
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error('CREDENTIAL_KEY must be 32 bytes, base64 encoded');
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypt a secret for storage.
 *
 * The IV is random per call and prefixed to the ciphertext. Prefixing
 * rather than storing it in its own column means the two can never be
 * mismatched, and a reused IV — which would leak plaintext relationships
 * under GCM — cannot happen through a copy-paste of the wrong row.
 */
export async function seal(env: Env, plaintext: string): Promise<Uint8Array> {
  const key = await keyFor(env, KEY_VERSION);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv, 0);
  out.set(body, iv.length);
  return out;
}

/** Decrypt, or throw. Never returns a partial or "best effort" value. */
export async function open(env: Env, sealed: Uint8Array, version: number): Promise<string> {
  if (sealed.length <= IV_BYTES) throw new Error('credential is truncated');
  const key = await keyFor(env, version);
  const iv = sealed.slice(0, IV_BYTES);
  const body = sealed.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
  return new TextDecoder().decode(plain);
}

/**
 * A short, non-reversible fingerprint of a secret.
 *
 * For showing the owner which token is connected without showing the
 * token, and for telling two credentials apart in a log. Truncated
 * deliberately: enough to distinguish, not enough to verify a guess.
 */
export async function fingerprint(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)]
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
