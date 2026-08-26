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

    /* Consuming the link IS the proof of address ownership, so this is
       where email_verified becomes true — including for an account that
       was created by password signup and has been waiting for it. */
    const [user] = await sql<{ id: string }[]>`
      insert into app_user (email, last_seen_at, email_verified)
      values (${email}, now(), true)
      on conflict (email) do update set last_seen_at = now(), email_verified = true
      returning id
    `;

    return startSession(sql, user.id);
  });
}

/**
 * Mint a session row and return the bearer half.
 *
 * Shared by every way in — link, password, Google — so all three
 * produce sessions with identical lifetime and storage. Only hashes
 * are written; the returned token exists nowhere but the cookie.
 */
async function startSession(sql: postgres.Sql, userId: string): Promise<Session> {
  const sessionToken = mintToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql`
    insert into session (id, user_id, expires_at)
    values (${await hashToken(sessionToken)}, ${userId}, ${expiresAt})
  `;
  return { token: sessionToken, userId, expiresAt };
}

/* ---------- password ------------------------------------------------ */

export type SignUpOutcome = 'created' | 'exists';

/**
 * Register an address, or decline silently if it is taken.
 *
 * An existing address never has its password overwritten, and the
 * caller answers identically either way. Both halves matter:
 * overwriting would hand any account to whoever guessed its address,
 * and answering differently would make this an account-existence
 * oracle — the exact leak /api/auth/request was built to avoid.
 *
 * Nothing here signs anyone in. The account is unverified until a link
 * sent to the address is consumed, so a signup on someone else's
 * address grants its author nothing at all.
 */
export async function signUpWithPassword(
  env: Env,
  email: string,
  passwordHash: string,
): Promise<SignUpOutcome> {
  return withUser(env, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      insert into app_user (email, password_hash, email_verified)
      values (${email}, ${passwordHash}, false)
      on conflict (email) do nothing
      returning id
    `;
    return rows.length > 0 ? 'created' : 'exists';
  });
}

export type LoginFailure = 'bad-credentials' | 'unverified';

/**
 * Sign in with a password.
 *
 * The hash is verified even when no account exists, against a dummy of
 * the same cost. Skipping it would make a missing account measurably
 * faster to reject than a wrong password, turning response time into
 * the account-existence oracle the status codes are careful not to be.
 */
export async function loginWithPassword(
  env: Env,
  email: string,
  password: string,
  verify: (password: string, stored: string | null) => Promise<boolean>,
  dummyHash: string,
): Promise<Session | LoginFailure> {
  return withUser(env, async (sql) => {
    const [user] = await sql<
      { id: string; password_hash: string | null; email_verified: boolean }[]
    >`select id, password_hash, email_verified from app_user where email = ${email}`;

    const ok = await verify(password, user?.password_hash ?? dummyHash);
    if (!user || !user.password_hash || !ok) return 'bad-credentials';

    /* Verified last, and only for a correct password. Reporting
       "unverified" to a wrong password would confirm the account
       exists. */
    if (!user.email_verified) return 'unverified';

    await sql`update app_user set last_seen_at = now() where id = ${user.id}`;
    return startSession(sql, user.id);
  });
}

/** Set or replace the password of an already-authenticated user. */
export async function setPassword(env: Env, userId: string, passwordHash: string): Promise<void> {
  await withUser(env, async (sql) => {
    await sql`update app_user set password_hash = ${passwordHash} where id = ${userId}`;
  });
}

/* ---------- google --------------------------------------------------- */

/**
 * Resolve a Google profile to a session, creating or linking as needed.
 *
 * Three cases, in order:
 *   1. This Google account is already linked — sign in, done.
 *   2. The email matches an existing account — link them.
 *   3. Neither — create the account.
 *
 * Case 2 is where the pre-hijacking risk lives. If the existing account
 * was never verified, it may have been created by someone who does not
 * own the address, sitting on a password waiting for the real owner to
 * arrive. Linking would hand them a live session. So an unverified
 * account has its password cleared as it is claimed: Google has just
 * asserted who owns the address, and the unproven credential loses.
 */
export async function signInWithGoogle(
  env: Env,
  profile: { subject: string; email: string; name: string | null },
): Promise<Session> {
  return withUser(env, async (sql) => {
    const userId = await claimGoogleIdentity(sql, profile);
    return startSession(sql, userId);
  });
}

/**
 * The linking decision, as a function of a connection rather than an
 * Env.
 *
 * Split out so the test suite executes THIS query rather than a copy
 * of it. A copied query is a test that passes while production drifts
 * away from it — and the branch below is one where drifting silently
 * means handing over accounts.
 */
export async function claimGoogleIdentity(
  sql: postgres.Sql,
  profile: { subject: string; email: string; name: string | null },
): Promise<string> {
  {
    const [linked] = await sql<{ user_id: string }[]>`
      select user_id from oauth_identity
       where provider = 'google' and subject = ${profile.subject}
    `;

    let userId: string;
    if (linked) {
      userId = linked.user_id;
      await sql`update app_user set last_seen_at = now() where id = ${userId}`;
    } else {
      const [user] = await sql<{ id: string; email_verified: boolean }[]>`
        insert into app_user (email, name, last_seen_at, email_verified)
        values (${profile.email}, ${profile.name}, now(), true)
        on conflict (email) do update
          set last_seen_at = now(),
              email_verified = true,
              -- Only when it was NOT already verified. A verified owner
              -- who set a password keeps it; an unverified account is
              -- being claimed, and whatever password it holds was never
              -- proven to belong to the address.
              password_hash = case when app_user.email_verified
                                   then app_user.password_hash
                                   else null end,
              name = coalesce(app_user.name, excluded.name)
        returning id, email_verified
      `;
      userId = user.id;
      await sql`
        insert into oauth_identity (provider, subject, user_id, email)
        values ('google', ${profile.subject}, ${userId}, ${profile.email})
        on conflict (provider, subject) do nothing
      `;
    }

    return userId;
  }
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
