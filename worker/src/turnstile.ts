/* ============================================================
   Cloudflare Turnstile, server side.

   The page renders a widget and sends its token with the link request,
   the password signup and the password login; this asks Cloudflare
   whether the token is real. No secret configured means no check at
   all — tests and local runs. A missing or rejected token is refused;
   Cloudflare itself being unreachable is not, because the rate limits
   underneath still hold and an outage at the checker must not close
   every door.
   ============================================================ */
import type { Env } from './env';

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileVerdict = 'ok' | 'missing' | 'rejected' | 'unavailable';

/** The one shape of fetch this needs; the global and a test fake both fit. */
type Fetcher = (input: string, init?: RequestInit) => Response | Promise<Response>;

/** Cloudflare caps tokens well under this; anything longer is not one. */
const TOKEN_MAX = 2048;

export function turnstileConfigured(env: Env): boolean {
  return Boolean(env.TURNSTILE_SECRET?.trim());
}

export async function verifyTurnstile(
  env: Env,
  token: unknown,
  ip: string,
  fetchImpl: Fetcher = fetch,
): Promise<TurnstileVerdict> {
  if (!turnstileConfigured(env)) return 'ok';
  if (typeof token !== 'string' || !token.trim() || token.length > TOKEN_MAX) return 'missing';

  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET!.trim(), response: token });
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  try {
    const res = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) return 'unavailable';
    const verdict = (await res.json().catch(() => null)) as { success?: unknown } | null;
    if (!verdict || typeof verdict.success !== 'boolean') return 'unavailable';
    return verdict.success ? 'ok' : 'rejected';
  } catch {
    return 'unavailable';
  }
}
