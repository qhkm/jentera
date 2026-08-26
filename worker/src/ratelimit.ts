/* ============================================================
   Throttling for the magic-link endpoint.

   Three brakes, because they stop different attacks:

   1. Edge burst, per IP, via the Workers rate-limit binding. Runs
      before any database or email work, so a flood costs nothing.
   2. Daily cap per IP. The burst limit alone permits 5/minute
      sustained — 7,200 sends a day from one host.
   3. Daily cap per address. Survives IP rotation, and is the one that
      stops a single inbox being buried.

   The pre-existing MAX_OUTSTANDING check in auth.ts stays. It caps
   concurrent *unconsumed* tokens, which is a different property: it
   limits how many valid links exist at once, not how many were sent.
   ============================================================ */

import type postgres from 'postgres';
import type { Env } from './env';
import { withUser } from './db';

/** Requests per minute per IP, refused at the edge. */
export const BURST_PER_MIN = 5;
/** Requests per rolling 24h per IP. Generous: offices and mobile
    carriers put many legitimate users behind one address. */
export const PER_IP_PER_DAY = 50;
/**
 * Attempts per rolling 24h per address.
 *
 * This counts attempts, not sends, so it has to leave room for a real
 * user who mistypes, signs in on a second device, or loses the first
 * email. MAX_OUTSTANDING in auth.ts is the tight short-range brake —
 * at most 3 live links at a time — and this one exists to catch the
 * patient attacker who waits out the 15-minute expiry and goes again.
 * Ten caps a bombing campaign at ten messages a day while staying well
 * clear of anything legitimate.
 */
export const PER_EMAIL_PER_DAY = 10;

export type Verdict = 'ok' | 'throttled-ip' | 'throttled-email';

/**
 * Keyed hash of the client address.
 *
 * Keyed rather than plain: an IPv4 address has only 2^32 possible
 * values, so an unkeyed digest is a lookup table away from the
 * original. The pepper is a Worker secret; the fallback exists so
 * local development runs without one, and is not a secret.
 */
async function hashIp(env: Env, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.RATE_LIMIT_PEPPER ?? 'aisar-local-dev-pepper'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The caller's address. Cloudflare sets this on every request; the
    fallback only matters for a direct unit-test invocation. */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/**
 * Decide whether this request may send a link.
 *
 * Attempts refused by a DAILY limit are still recorded — the insert
 * shares a statement with the count, so it happens regardless of the
 * verdict. That is deliberate: if a throttled caller's attempts did
 * not count, their window would drain while they kept knocking and
 * they would get a fresh allowance the moment it rolled over.
 *
 * Attempts refused by the BURST limit are not recorded, because that
 * refusal returns before touching the database — which is the whole
 * point of having it. Cloudflare holds that counter at the edge.
 */
export async function checkAuthRate(
  env: Env,
  request: Request,
  email: string,
): Promise<Verdict> {
  const ip = clientIp(request);

  /* Edge first. This is the only check that costs nothing, so it is
     the one that has to absorb a flood. It is per-colo rather than
     global, so treat it as a burst brake, not an exact quota — the
     daily counters below are the authoritative ones. */
  const burst = await env.AUTH_BURST.limit({ key: ip });
  if (!burst.success) return 'throttled-ip';

  const ipHash = await hashIp(env, ip);

  return withUser(env, async (sql) => {
    const { byEmail, byIp } = await countAndRecord(sql, email, ipHash);
    if (byIp >= PER_IP_PER_DAY) return 'throttled-ip';
    if (byEmail >= PER_EMAIL_PER_DAY) return 'throttled-email';
    return 'ok';
  });
}

/**
 * Count the window, record the attempt, sweep old rows — one statement.
 *
 * Takes a connection rather than an Env so the tests exercise this
 * exact SQL. The subtlety worth protecting is that the counts and the
 * insert share a snapshot, so a request is never counted against
 * itself; a copied query in a test would not notice that changing.
 */
export async function countAndRecord(
  sql: postgres.Sql,
  email: string,
  ipHash: string,
): Promise<{ byEmail: number; byIp: number }> {
  {
    const [row] = await sql<{ by_email: string; by_ip: string }[]>`
      with counts as (
        select count(*) filter (where email = ${email})     as by_email,
               count(*) filter (where ip_hash = ${ipHash})  as by_ip
          from auth_attempt
         where created_at > now() - interval '24 hours'
      ),
      recorded as (
        insert into auth_attempt (email, ip_hash) values (${email}, ${ipHash})
      ),
      swept as (
        -- Kept longer than the 24h window so a spike is still
        -- inspectable after the fact. Cheap: an index range scan that
        -- matches nothing on almost every request.
        delete from auth_attempt where created_at < now() - interval '7 days'
      )
      select by_email::text, by_ip::text from counts`;

    return { byEmail: Number(row.by_email), byIp: Number(row.by_ip) };
  }
}

/**
 * Burst brake for password login.
 *
 * Two keys, because they stop different shapes of attack: per IP stops
 * one host grinding through passwords, per address stops a botnet
 * grinding through one account from many hosts. Both share the
 * AUTH_BURST binding — the namespace is keyed by string, so a prefix
 * keeps these counters separate from the magic-link ones rather than
 * having link requests and login attempts consume each other's budget.
 *
 * No database write. A failed login should cost an attacker everything
 * and us nothing.
 */
export async function checkLoginBurst(
  env: Env,
  request: Request,
  email: string,
): Promise<boolean> {
  const ip = clientIp(request);
  const [byIp, byEmail] = await Promise.all([
    env.AUTH_BURST.limit({ key: `login-ip:${ip}` }),
    env.AUTH_BURST.limit({ key: `login-email:${email}` }),
  ]);
  return byIp.success && byEmail.success;
}
