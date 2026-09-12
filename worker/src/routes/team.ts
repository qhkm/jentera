/* ============================================================
   The team: who belongs to a business, and inviting the next person.

   GET    /api/team                      members and open invitations
                                         (any member; `canManage` says who
                                         may change them)
   POST   /api/team/invitations          invite an address (owner, team plan)
   DELETE /api/team/invitations/:id      revoke an open invitation (owner)
   POST   /api/team/invitations/accept   the invited person, signed in with
                                         that address, becomes staff

   Team is a plan: every write here checks it inside the tenant
   transaction, and a business off the plan gets 402, not a silent no.

   An invitation names an address. Whoever signs in through any of the
   three doors with that verified address may accept it — every session
   belongs to a verified address already, so the match is the check. The
   token travels only in the email and the table keeps its SHA-256;
   acceptance is a conditional UPDATE under a row lock, so a replayed
   link finds nothing to accept. The business behind a token is found by
   a security-definer function that returns ids and nothing else, because
   the accepting person has no tenant yet.

   One business per person for now: an account that already belongs to a
   business is refused with a message, not silently attached to a second
   one it could never reach. Switching between businesses is deferred.
   ============================================================ */
import type { Env } from '../env';
import { withTenant, withUser } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { getBusinessPlan } from '../agent-runtime';
import { sendNotice } from '../email';

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INVITATION_TTL_MS = 7 * 24 * 3_600_000;

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/* Cookie-authenticated writes from the browser: the same origin check the
   task-review route makes, so a cross-site form cannot invite or accept. */
function originAllowed(request: Request, cors: Record<string, string>): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === cors['Access-Control-Allow-Origin'];
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

const INVITATION_COLUMNS = 'id, email, role, created_at, expires_at, accepted_at, revoked_at';

const invitationJson = (row: InvitationRow) => ({
  id: row.id,
  email: row.email,
  role: row.role,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
});

type Refusal = { status: 400 | 402 | 403 | 404 | 409 | 410; err: string };

export async function handleTeam(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/team')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);

  /* ---- accept: signed in is enough; the business comes from the token ---- */
  if (url.pathname === '/api/team/invitations/accept' && request.method === 'POST') {
    if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    const body = await request.json().catch(() => null) as { token?: unknown } | null;
    const token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : '';
    if (!TOKEN.test(token)) return json({ ok: false, err: 'token required' }, { status: 400 }, cors);
    const hash = await sha256Hex(token);
    const found = await withUser(env, async (sql) => {
      const [row] = await sql<{ id: string; business_id: string }[]>`
        select id, business_id from invitation_by_token(${hash})`;
      return row ?? null;
    });
    if (!found) return json({ ok: false, err: 'This invitation is not valid.' }, { status: 404 }, cors);
    const email = identity.email.toLowerCase();
    const outcome = await withTenant(env, found.business_id, async (tx): Promise<Refusal | { status: 200; businessName: string }> => {
      const [invitation] = await tx<InvitationRow[]>`
        select ${tx.unsafe(INVITATION_COLUMNS)} from invitation where id = ${found.id} for update`;
      if (!invitation) return { status: 404, err: 'This invitation is not valid.' };
      if (invitation.accepted_at || invitation.revoked_at || invitation.expires_at.getTime() <= Date.now()) {
        return { status: 410, err: 'This invitation is no longer valid. Ask the owner for a new one.' };
      }
      if (await getBusinessPlan(tx, found.business_id) !== 'team') {
        return { status: 402, err: 'This business is not on the Team plan.' };
      }
      if (invitation.email !== email) {
        return { status: 403, err: 'This invitation was sent to a different email address. Sign in with that address to accept it.' };
      }
      const [existing] = await tx<{ business_id: string }[]>`
        select business_id from membership where user_id = ${identity.userId} limit 1`;
      if (existing) {
        return existing.business_id === found.business_id
          ? { status: 409, err: 'You are already a member of this business.' }
          : { status: 409, err: 'This account already belongs to a business. Use another email address to join this one.' };
      }
      await tx`insert into membership (user_id, business_id, role)
               values (${identity.userId}, ${found.business_id}, ${invitation.role})`;
      await tx`update invitation set accepted_at = now(), accepted_by = ${identity.userId} where id = ${invitation.id}`;
      const [business] = await tx<{ name: string }[]>`select name from business where id = ${found.business_id}`;
      return { status: 200, businessName: business?.name ?? '' };
    });
    if (outcome.status !== 200) return json({ ok: false, err: outcome.err }, { status: outcome.status }, cors);
    return json({ ok: true, businessName: outcome.businessName }, {}, cors);
  }

  if (!hasBusiness(identity)) return json({ ok: false, err: 'no business' }, { status: 401 }, cors);
  const { businessId } = identity;

  if (url.pathname === '/api/team' && request.method === 'GET') {
    const { members, invitations } = await withTenant(env, businessId, async (tx) => ({
      members: await tx<{ user_id: string; email: string; role: string; created_at: Date }[]>`
        select m.user_id, u.email, m.role, m.created_at
          from membership m join app_user u on u.id = m.user_id
         where m.business_id = ${businessId}
         order by case m.role when 'owner' then 0 else 1 end, m.created_at`,
      invitations: await tx<InvitationRow[]>`
        select ${tx.unsafe(INVITATION_COLUMNS)} from invitation
         where business_id = ${businessId} and accepted_at is null and revoked_at is null and expires_at > now()
         order by created_at`,
    }));
    return json({
      ok: true,
      members: members.map((m) => ({
        userId: m.user_id, email: m.email, role: m.role, joinedAt: m.created_at.toISOString(), you: m.user_id === identity.userId,
      })),
      invitations: invitations.map(invitationJson),
      canManage: can(identity, 'team.manage'),
    }, {}, { ...cors, 'Cache-Control': 'private, no-store' });
  }

  if (url.pathname === '/api/team/invitations' && request.method === 'POST') {
    if (!can(identity, 'team.manage')) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 320) return json({ ok: false, err: 'invalid email' }, { status: 400 }, cors);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await sha256Hex(token);
    const result = await withTenant(env, businessId, async (tx): Promise<Refusal | { status: 201; row: InvitationRow; businessName: string }> => {
      if (await getBusinessPlan(tx, businessId) !== 'team') {
        return { status: 402, err: 'This business is not on the Team plan.' };
      }
      const [member] = await tx<{ found: number }[]>`
        select 1 as found from membership m join app_user u on u.id = m.user_id
         where m.business_id = ${businessId} and lower(u.email) = ${email} limit 1`;
      if (member) return { status: 409, err: 'That person is already a member.' };
      const [open] = await tx<{ found: number }[]>`
        select 1 as found from invitation
         where business_id = ${businessId} and email = ${email}
           and accepted_at is null and revoked_at is null and expires_at > now() limit 1`;
      if (open) return { status: 409, err: 'That address already has an open invitation. Revoke it to send a new one.' };
      /* An expired one still holds the address under the open-invitation
         index; retire it so the new one can take its place. */
      await tx`update invitation set revoked_at = now()
                where business_id = ${businessId} and email = ${email} and accepted_at is null and revoked_at is null`;
      const [row] = await tx<InvitationRow[]>`
        insert into invitation (business_id, email, role, token_hash, invited_by, expires_at)
        values (${businessId}, ${email}, 'staff', ${hash}, ${identity.userId}, ${new Date(Date.now() + INVITATION_TTL_MS)})
        returning ${tx.unsafe(INVITATION_COLUMNS)}`;
      const [business] = await tx<{ name: string }[]>`select name from business where id = ${businessId}`;
      return { status: 201, row, businessName: business?.name ?? 'your business' };
    });
    if (result.status !== 201) return json({ ok: false, err: result.err }, { status: result.status }, cors);
    /* The only place the token ever appears. */
    const link = `${env.APP_ORIGIN}/join?token=${token}`;
    await sendNotice(env, email, `You're invited to join ${result.businessName} on Jentera`, [
      `${identity.email} has invited you to join ${result.businessName} on Jentera.`,
      '',
      'Open this link and sign in with this email address to accept:',
      link,
      '',
      'The invitation expires in 7 days.',
      "If you weren't expecting this, you can ignore this email.",
    ].join('\n'));
    return json({ ok: true, invitation: invitationJson(result.row) }, { status: 201 }, cors);
  }

  /* ---- offboarding: a staff member leaves the business --------------------
     Everything that lets them in or reaches them goes in one transaction:
     the membership, their sessions, their devices, their pending pushes,
     their workspace seats, and any invitation still open for their address.
     Their chats and the work they asked for stay as history. */
  const removeMember = url.pathname.match(/^\/api\/team\/members\/([0-9a-f-]{36})$/i);
  if (removeMember && request.method === 'DELETE') {
    if (!can(identity, 'team.manage')) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    if (!UUID.test(removeMember[1])) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    const memberId = removeMember[1];
    const result = await withTenant(env, businessId, async (tx): Promise<Refusal | { status: 200 }> => {
      const [membership] = await tx<{ owner: boolean; email: string }[]>`
        select (m.role = 'owner') as owner, u.email from membership m join app_user u on u.id = m.user_id
         where m.business_id = ${businessId} and m.user_id = ${memberId} for update of m`;
      if (!membership) return { status: 404, err: 'not found' };
      if (membership.owner || memberId === identity.userId) {
        return { status: 409, err: 'The owner cannot be removed from their own business.' };
      }
      await tx`delete from membership where business_id = ${businessId} and user_id = ${memberId}`;
      await tx`update session set revoked_at = now() where user_id = ${memberId} and revoked_at is null`;
      await tx`delete from push_outbox where business_id = ${businessId} and user_id = ${memberId}`;
      await tx`delete from push_subscription where business_id = ${businessId} and user_id = ${memberId}`;
      await tx`delete from workspace_member where business_id = ${businessId} and user_id = ${memberId}`;
      await tx`update invitation set revoked_at = now()
                where business_id = ${businessId} and email = ${membership.email.toLowerCase()}
                  and accepted_at is null and revoked_at is null`;
      return { status: 200 };
    });
    if (result.status !== 200) return json({ ok: false, err: result.err }, { status: result.status }, cors);
    return json({ ok: true }, {}, cors);
  }

  const revoke = url.pathname.match(/^\/api\/team\/invitations\/([0-9a-f-]{36})$/i);
  if (revoke && request.method === 'DELETE') {
    if (!can(identity, 'team.manage')) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    if (!UUID.test(revoke[1])) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    const revoked = await withTenant(env, businessId, async (tx) => {
      const rows = await tx`update invitation set revoked_at = now()
        where business_id = ${businessId} and id = ${revoke[1]} and accepted_at is null and revoked_at is null
        returning id`;
      return rows.length > 0;
    });
    return json({ ok: revoked, ...(revoked ? {} : { err: 'not found' }) }, { status: revoked ? 200 : 404 }, cors);
  }

  return null;
}
