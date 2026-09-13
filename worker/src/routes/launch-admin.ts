import type { Env } from '../env';
import { ACCESS_OWNER } from '../access';
import { hashToken, readCookie, verifyIdentitySession } from '../auth';
import { withUser, withTenant } from '../db';

/** A platform-admin surface, never enabled by a tenant's owner role or plan. */
export async function handleLaunchAdmin(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/admin/launch')) return null;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const token = readCookie(request);
  const identity = token ? await verifyIdentitySession(env, token) : null;
  if (!identity || identity.email.toLowerCase() !== ACCESS_OWNER) return json({ err: 'Not found.' }, 404);
  const verified = await withUser(env, async sql => {
    const [user] = await sql`select email_verified from app_user where id=${identity.userId}`;
    return user?.email_verified === true;
  });
  if (!verified) return json({ err: 'Not found.' }, 404);
  if (request.method === 'POST' && !(env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).includes(request.headers.get('Origin') ?? '')) return json({ err: 'Untrusted request origin.' }, 403);

  if (url.pathname === '/api/admin/launch/invites' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === ACCESS_OWNER) return json({ err: 'Enter a valid recipient email.' }, 400);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
    const hash = await hashToken(code);
    const created = await withUser(env, sql => sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
      const [used] = await tx`select 1 from trial_redemption r join app_user u on u.id=r.user_id where lower(u.email)=${email}`;
      if (used) return null;
      const [row] = await tx<{ expires_at: Date }[]>`insert into trial_invite (token_hash,email,expires_at) values (${hash},${email},now()+interval '7 days') returning expires_at`;
      return row;
    }));
    if (!created) return json({ err: 'This account has already used its trial.' }, 409);
    return json({ email, code, expiresAt: created.expires_at, trialHours: 72 }, 201);
  }
  if (url.pathname !== '/api/admin/launch' || request.method !== 'GET') return json({ err: 'Not found.' }, 404);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return json({ err: 'Invalid page.' }, 400);
  const data = await withUser(env, async sql => {
    const [totals] = await sql`select (select count(*)::int from waitlist_entry) as waitlist,
      (select count(distinct email)::int from trial_invite) as invited,
      (select count(*)::int from trial_redemption) as redeemed,
      (select count(*)::int from platform_access where kind='trial' and revoked_at is null and expires_at>now()) as active`;
    const rows = await sql`with people as (
      select email, created_at from waitlist_entry union all select email, created_at from trial_invite where email is not null
    ), emails as (select email,min(created_at) as first_seen from people group by email)
    select e.email, w.created_at as joined_at,
      (select max(created_at) from trial_invite where email=e.email) as invited_at,
      r.started_at as redeemed_at, r.expires_at as trial_expires_at,
      a.kind as access_kind,a.expires_at as access_expires_at,a.revoked_at,
      u.id as user_id,
      (select m.business_id from membership m where m.user_id=u.id and m.role='owner' order by m.business_id limit 1) as business_id
    from emails e left join waitlist_entry w on w.email=e.email left join app_user u on lower(u.email)=e.email
      left join trial_redemption r on r.user_id=u.id left join platform_access a on a.email=e.email
    order by e.first_seen desc,e.email limit 26 offset ${offset}`;
    return { totals, rows };
  });
  const rows = [];
  for (const row of data.rows.slice(0, 25)) {
    let firstCompletedRequest: Date | null = null;
    if (row.business_id && row.redeemed_at) firstCompletedRequest = await withTenant(env, row.business_id, async tx => {
      const [result] = await tx`select min(r.ended_at) as completed_at from run r join chat_session c on c.id=r.session_id and c.business_id=r.business_id
        where r.business_id=${row.business_id} and c.created_by=${row.user_id} and r.trigger_shape='owner.ask'
        and r.status='completed' and r.created_at>=${row.redeemed_at}`;
      return result?.completed_at ?? null;
    });
    const { user_id, business_id, ...publicRow } = row;
    rows.push({ ...publicRow, firstCompletedRequest });
  }
  return json({ totals: data.totals, rows, hasMore: data.rows.length > 25 });
}
