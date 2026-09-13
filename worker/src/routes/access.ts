import type { Env } from '../env';
import { accessForEmail, restrictedAccess, TRIAL_HOURS } from '../access';
import { authLandingPath, hashToken, readCookie, verifyIdentitySession } from '../auth';
import { withUser } from '../db';
import { checkAuthRate, clientIp } from '../ratelimit';
import { verifyTurnstile } from '../turnstile';
import { notifyWaitlist } from '../signup-notice';

export async function handleAccess(request: Request, env: Env, url: URL, cors: Record<string, string>, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response | null> {
  if (!['/api/access', '/api/access/redeem', '/api/waitlist'].includes(url.pathname)) return null;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method === 'POST' && !(env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).includes(request.headers.get('Origin') ?? '')) {
    return json({ err: 'Untrusted request origin.' }, 403);
  }
  if (url.pathname === '/api/waitlist' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({})) ?? {}) as { email?: unknown; turnstileToken?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ err: 'Enter a valid email address.' }, 400);
    const bot = await verifyTurnstile(env, body.turnstileToken, clientIp(request));
    if (bot !== 'ok') return json({ err: 'Please complete the security check and try again.' }, 400);
    const rate = await checkAuthRate(env, request, email);
    if (rate === 'throttled-ip') return json({ err: 'Please try again later.' }, 429);
    if (rate === 'ok') {
      const [entry] = await withUser(env, sql => sql<{ created_at: Date }[]>`insert into waitlist_entry (email) values (${email}) on conflict do nothing returning created_at`);
      if (entry) {
        const notice = notifyWaitlist(env, email, new Date(entry.created_at));
        if (ctx) ctx.waitUntil(notice);
        else await notice;
      }
    }
    return json({ ok: true }, 202);
  }
  const token = readCookie(request);
  const identity = token ? await verifyIdentitySession(env, token) : null;
  if (request.method === 'GET' && url.pathname === '/api/access') {
    return json({ restricted: restrictedAccess(env), signedIn: !!identity, access: identity ? await accessForEmail(env, identity.email) : null });
  }
  if (request.method !== 'POST' || url.pathname !== '/api/access/redeem') return json({ err: 'Method not allowed.' }, 405);
  if (!identity) return json({ err: 'Sign in to redeem your invite code.' }, 401);
  if (!restrictedAccess(env)) return json({ err: 'Invite trials are not enabled.' }, 409);
  const rate = await checkAuthRate(env, request, identity.email);
  if (rate !== 'ok') return json({ err: 'Please try again later.' }, 429);
  const body = (await request.json().catch(() => ({})) ?? {}) as { code?: unknown };
  if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{32,100}$/.test(body.code.trim())) return json({ err: 'Invalid or unavailable invite code.' }, 400);
  const hash = await hashToken(body.code.trim());
  const accepted = await withUser(env, async sql => sql.begin(async tx => {
    // Serialize different codes for one user as well as users racing for one code.
    await tx`select pg_advisory_xact_lock(hashtextextended(${identity.userId}, 0))`;
    const [previous] = await tx`select user_id from trial_redemption where user_id = ${identity.userId}`;
    if (previous) return false;
    const [grant] = await tx`select kind, revoked_at from platform_access where email = ${identity.email.toLowerCase()} for update`;
    if (grant && (grant.kind === 'paid' || grant.revoked_at)) return false;
    const [invite] = await tx`update trial_invite set redeemed_by = ${identity.userId}, redeemed_at = now()
      where token_hash = ${hash} and redeemed_at is null and revoked_at is null and expires_at > now()
      and (email is null or email = ${identity.email.toLowerCase()}) returning token_hash`;
    if (!invite) return false;
    await tx`insert into trial_redemption (user_id, token_hash, expires_at) values (${identity.userId}, ${hash}, now() + ${TRIAL_HOURS} * interval '1 hour')`;
    await tx`insert into platform_access (email, kind, expires_at, note)
      values (${identity.email.toLowerCase()}, 'trial', now() + ${TRIAL_HOURS} * interval '1 hour', 'Invite code redemption')
      on conflict (email) do update set kind = 'trial', expires_at = excluded.expires_at, revoked_at = null
      where platform_access.kind <> 'paid' and platform_access.revoked_at is null`;
    return true;
  }));
  if (!accepted) return json({ err: 'Invalid or unavailable invite code, or a trial was already used.' }, 400);
  return json({ ok: true, next: await authLandingPath(env, identity.userId) });
}
