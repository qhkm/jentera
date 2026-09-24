/* ============================================================
   The ticket a sprite presents to download its runner bundle.

   Until 2026-09-23 the bundle came from raw.githubusercontent.com, which
   serves public repositories anonymously and nothing else. That is the single
   reason this repository could not be private: flipping visibility answered
   404 to every bootstrap and the next fresh provision died with curl exit 22.

   Moving the bundle to R2 means the sprite now needs a way to prove it may
   have it. It has no identity yet — the bundle download happens before the
   runner exists, on a machine that holds no credential — so the ticket cannot
   be something the sprite presents from storage. It is minted by the control
   plane into the very command it is about to run, which is the one moment
   where trust already exists.

   Bound to one commit, so a ticket that leaks cannot be aimed at a different
   bundle, and short-lived, so one that leaks does not stay useful.
   ============================================================ */

import type { Env } from '../env';

/** Long enough to outlast a slow download and clock skew, short enough that a
 *  ticket recovered from a log is worthless by the time it is read. */
const TICKET_TTL_SECONDS = 15 * 60;

/** Domain separation: CREDENTIAL_KEY signs other things, and a key used for
 *  two purposes is a key where one purpose can forge the other. */
const PURPOSE = 'jentera-runtime-bundle-v1';

async function signingKey(env: Env): Promise<CryptoKey> {
  const secret = env.CREDENTIAL_KEY;
  if (!secret) throw new Error('CREDENTIAL_KEY is required to sign a bundle ticket');
  const root = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', root, new TextEncoder().encode(PURPOSE));
  return crypto.subtle.importKey(
    'raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const message = (commit: string, expiresAt: number) =>
  new TextEncoder().encode(`${PURPOSE}.${commit}.${expiresAt}`);

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(text: string): Uint8Array | null {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Mint a ticket for one commit's bundle. */
export async function issueBundleTicket(
  env: Env,
  commit: string,
  now = Math.floor(Date.now() / 1_000),
): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('bundle commit is invalid');
  const expiresAt = now + TICKET_TTL_SECONDS;
  const key = await signingKey(env);
  const signature = await crypto.subtle.sign('HMAC', key, message(commit, expiresAt));
  return `${expiresAt}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Does this ticket entitle the bearer to this commit's bundle?
 *
 * Verification goes through crypto.subtle.verify rather than comparing
 * strings: the comparison is constant time there, and a hand-rolled one is
 * how a signature check becomes a timing oracle.
 */
export async function bundleTicketIsValid(
  env: Env,
  commit: string,
  ticket: string | null | undefined,
  now = Math.floor(Date.now() / 1_000),
): Promise<boolean> {
  if (!ticket || !/^[0-9a-f]{40}$/.test(commit)) return false;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = Number(ticket.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  /* An expiry far in the future is a forged or corrupted one; without this a
     ticket that never expires is a ticket, not a mistake. */
  if (expiresAt > now + TICKET_TTL_SECONDS) return false;
  const signature = fromBase64url(ticket.slice(dot + 1));
  if (!signature) return false;
  const key = await signingKey(env);
  try {
    return await crypto.subtle.verify('HMAC', key, signature, message(commit, expiresAt));
  } catch {
    return false;
  }
}
