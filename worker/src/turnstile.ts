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
type TurnstileEnv = { TURNSTILE_SECRET?: string; ALLOWED_ORIGINS?: string };

/** What a token must say to count: the action its widget was rendered with
    and the hostnames it may have been minted on. */
export interface TurnstileExpectation { action: string; hostnames: ReadonlySet<string> }

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileVerdict = 'ok' | 'missing' | 'rejected' | 'unavailable';

/** The one shape of fetch this needs; the global and a test fake both fit. */
type Fetcher = (input: string, init?: RequestInit) => Response | Promise<Response>;

/** Cloudflare caps tokens well under this; anything longer is not one. */
const TOKEN_MAX = 2048;
/** The widget on the sign-in page is rendered with this action, and a
    token minted for any other is not from that page. */
export const TURNSTILE_ACTION = 'signin';
/** Cloudflare answers within this or the request is admitted unchecked. */
const SITEVERIFY_TIMEOUT_MS = 10_000;

/** The hostnames a token may have been minted on: the same list the
    browser is allowed to call us from, so one setting names both. */
function allowedHostnames(env: TurnstileEnv): Set<string> {
  const hosts = new Set<string>();
  for (const origin of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    try {
      hosts.add(new URL(origin.trim()).hostname);
    } catch {
      /* A malformed entry allows nothing. */
    }
  }
  return hosts;
}

export function turnstileConfigured(env: Pick<TurnstileEnv, 'TURNSTILE_SECRET'>): boolean {
  return Boolean(env.TURNSTILE_SECRET?.trim());
}

export async function verifyTurnstile(
  env: TurnstileEnv,
  token: unknown,
  ip: string,
  fetchImpl: Fetcher = fetch,
  expected?: TurnstileExpectation,
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
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return 'unavailable';
    const verdict = (await res.json().catch(() => null)) as
      { success?: unknown; action?: unknown; hostname?: unknown } | null;
    if (!verdict || typeof verdict.success !== 'boolean') return 'unavailable';
    if (!verdict.success) return 'rejected';
    /* A real token, but was it made on our page? One widget can be
       embedded on any hostname it lists, under any action. */
    const wanted = expected ?? { action: TURNSTILE_ACTION, hostnames: allowedHostnames(env) };
    if (verdict.action !== wanted.action) return 'rejected';
    if (typeof verdict.hostname !== 'string' || !wanted.hostnames.has(verdict.hostname)) return 'rejected';
    return 'ok';
  } catch {
    return 'unavailable';
  }
}
