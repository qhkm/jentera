import type { Env } from './env';

const PURPOSE = 'aisar:telegram-internal-pairing:v1:';

/** Stable one-time deep-link proof derived from a Worker-only secret. It is
    never stored in Postgres and cannot be guessed from a public connection id. */
export async function telegramPairingCode(env: Env, connectionId: string): Promise<string> {
  const bytes = Uint8Array.from(atob(env.CREDENTIAL_KEY ?? ''), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('CREDENTIAL_KEY must be 32 bytes, base64 encoded');
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${PURPOSE}${connectionId}`),
  ));
  return base64Url(signed.slice(0, 24));
}

export async function validTelegramPairingCode(
  env: Env,
  connectionId: string,
  presented: string,
): Promise<boolean> {
  const expected = await telegramPairingCode(env, connectionId);
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}

export async function telegramPairingUrl(
  env: Env,
  connectionId: string,
  displayName: string | null,
): Promise<string | null> {
  const username = displayName?.replace(/^@/, '');
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  return `https://t.me/${username}?start=${await telegramPairingCode(env, connectionId)}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
