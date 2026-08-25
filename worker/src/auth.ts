/* ============================================================
   Magic-link sign-in.

   Two secrets exist here and neither is ever stored in the clear:
   the link token and the session token. The database holds only
   SHA-256 hashes, so a leaked dump yields nothing usable.
   ============================================================ */

import type postgres from 'postgres';
import type { Env } from './env';
import { withUser } from './db';

/** 15 minutes. Long enough to walk to a laptop, short enough to matter. */
const LINK_TTL_MS = 15 * 60 * 1000;
/** 30 days. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Outstanding unconsumed links per address before we quietly stop sending. */
const MAX_OUTSTANDING = 3;

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function mintToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface IssueResult {
  /** null when rate-limited. The caller still answers 204 either way. */
  token: string | null;
}

/**
 * Issue a link token for an address.
 *
 * Deliberately does NOT reveal whether the address has an account — the
 * caller returns 204 regardless. A different answer for known and unknown
 * addresses turns this endpoint into an account-existence oracle.
 */
export async function issueLoginToken(env: Env, email: string): Promise<IssueResult> {
  return withUser(env, async (sql) => {
    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from login_token
       where email = ${email} and consumed_at is null and expires_at > now()
    `;
    if (Number(count) >= MAX_OUTSTANDING) return { token: null };

    const token = mintToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await sql`
      insert into login_token (token_hash, email, expires_at)
      values (${await hashToken(token)}, ${email}, ${expiresAt})
    `;
    return { token };
  });
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Consume a link token and mint a session, or return null.
 *
 * The consume is a single conditional UPDATE. That is what makes a
 * replayed link fail: the second attempt matches no row, because the
 * first already set consumed_at. A select-then-update would leave a
 * window where a link forwarded to two devices mints two sessions.
 */
export async function consumeLoginToken(env: Env, token: string): Promise<Session | null> {
  const tokenHash = await hashToken(token);

  return withUser(env, async (sql) => {
    const rows = await sql<{ email: string }[]>`
      update login_token
         set consumed_at = now()
       where token_hash = ${tokenHash}
         and consumed_at is null
         and expires_at > now()
      returning email
    `;
    if (rows.length === 0) return null;

    const email = rows[0].email;

    const [user] = await sql<{ id: string }[]>`
      insert into app_user (email, last_seen_at) values (${email}, now())
      on conflict (email) do update set last_seen_at = now()
      returning id
    `;

    const sessionToken = mintToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await sql`
      insert into session (id, user_id, expires_at)
      values (${await hashToken(sessionToken)}, ${user.id}, ${expiresAt})
    `;

    return { token: sessionToken, userId: user.id, expiresAt };
  });
}

export interface Identity {
  userId: string;
  email: string;
  businessId: string | null;
  role: 'owner' | 'staff' | null;
}

/** Resolve a session cookie to an identity, or null. */
export async function verifySession(env: Env, token: string): Promise<Identity | null> {
  const id = await hashToken(token);
  return withUser(env, async (sql) => {
    const rows = await sql<
      { user_id: string; email: string; business_id: string | null; role: string | null }[]
    >`
      select s.user_id, u.email, m.business_id, m.role
        from session s
        join app_user u on u.id = s.user_id
        left join membership m on m.user_id = s.user_id
       where s.id = ${id}
         and s.revoked_at is null
         and s.expires_at > now()
       limit 1
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      userId: r.user_id,
      email: r.email,
      businessId: r.business_id,
      role: (r.role as 'owner' | 'staff' | null) ?? null,
    };
  });
}

export async function revokeSession(env: Env, token: string): Promise<void> {
  const id = await hashToken(token);
  await withUser(env, async (sql) => {
    await sql`update session set revoked_at = now() where id = ${id} and revoked_at is null`;
  });
}

export const COOKIE_NAME = 'aisar_session';

/**
 * SameSite=Lax, not Strict. The magic link is followed from an email
 * client, which is a cross-site navigation — Strict would withhold the
 * cookie on exactly that hop, so the user would land signed out having
 * just signed in.
 */
export function sessionCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearedCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=') || null;
  }
  return null;
}
