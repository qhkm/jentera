/* ============================================================
   Google sign-in.

   Authorization Code flow with PKCE. The code-for-token exchange is
   done server side, so the client secret never leaves the Worker and
   the browser never holds a Google token.

   Why the id_token is not verified by signature here: it arrives in the
   response body of a direct, server-to-server HTTPS POST to
   oauth2.googleapis.com, authenticated with our client secret. There is
   no third party in that exchange to forge it. Signature verification
   matters when an id_token arrives from somewhere less trustworthy —
   the implicit flow, or a client handing one over — and neither
   happens here. Google's own docs say the same.
   ============================================================ */

import type { Env } from './env';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

export interface GoogleProfile {
  /** Google's stable per-account id. The join key — not the email,
      which a user can change. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Where Google sends the browser back. Must match a redirect URI
    registered on the OAuth client exactly, including scheme and path. */
export function redirectUri(env: Env): string {
  return `${env.API_ORIGIN}/api/auth/google/callback`;
}

const b64url = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function randomUrlSafe(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

export async function s256(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export function authorizeUrl(
  env: Env,
  opts: { state: string; codeChallenge: string },
): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: 'openid email profile',
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    // Ask for an account choice rather than silently reusing whichever
    // Google session the browser happens to hold. Someone signing in on
    // a shared machine should not land in the previous person's account.
    prompt: 'select_account',
  });
  return `${AUTHORIZE}?${p}`;
}

/** Decode a JWT payload without verifying. Safe only because of where
    this token came from — see the note at the top of the file. */
function decodePayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Exchange the authorization code for a profile, or null.
 *
 * Null on every failure path, deliberately: the caller turns that into
 * one generic redirect. Distinguishing "bad code" from "expired code"
 * from "Google is down" would tell an attacker which of their guesses
 * was closer.
 */
export async function exchangeCode(
  env: Env,
  code: string,
  codeVerifier: string,
): Promise<GoogleProfile | null> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    console.error(`[oauth] google token exchange ${res.status}: ${await res.text()}`);
    return null;
  }

  const body = (await res.json().catch(() => null)) as { id_token?: string } | null;
  if (!body?.id_token) return null;

  const claims = decodePayload(body.id_token);
  if (!claims) return null;

  /* Even trusting the transport, the audience is worth checking: it
     costs nothing and catches a misconfigured client id pointing at
     someone else's project. */
  if (claims.aud !== env.GOOGLE_CLIENT_ID) {
    console.error('[oauth] id_token aud mismatch');
    return null;
  }

  const subject = typeof claims.sub === 'string' ? claims.sub : null;
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  if (!subject || !email) return null;

  return {
    subject,
    email,
    // Google sends this as a real boolean, but has historically sent
    // the string "true" through some paths. Accept both rather than
    // silently treating "true" as unverified.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' ? claims.name : null,
  };
}
