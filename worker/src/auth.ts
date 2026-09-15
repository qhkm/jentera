/* ============================================================
   Magic-link sign-in.

   Two secrets exist here and neither is ever stored in the clear:
   the link token and the session token. The database holds only
   SHA-256 hashes, so a leaked dump yields nothing usable.
   ============================================================ */

import type postgres from 'postgres';
import type { Env } from './env';
import { withTenant, withUser } from './db';
import { accessForEmail, restrictedAccess } from './access';

/** 15 minutes. Long enough to walk to a laptop, short enough to matter. */
const LINK_TTL_MS = 15 * 60 * 1000;
/** 30 days. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Which door a session came through. */
export type SessionKind = 'web' | 'native';

/* 7 days for the app, against the web's 30.

   A web session is an HttpOnly cookie: script cannot read it and it dies
   with the browser profile. A native session is a bearer the app keeps in
   Keychain or Keystore and puts in a header — portable, readable by the
   code that holds it, and surviving an uninstall on iOS. Until there is a
   devices list to revoke one from, its lifetime is the only bound on a
   leak, so it is shorter. Decided with the owner on 2026-09-15. */
const NATIVE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** One minute. The app is already waiting for this browser hand-off. */
const NATIVE_CODE_TTL_MS = 60 * 1000;
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

export interface NativeAuthRequest {
  state: string;
  codeChallenge: string;
}

/**
 * Issue a link token for an address.
 *
 * Deliberately does NOT reveal whether the address has an account — the
 * caller returns 204 regardless. A different answer for known and unknown
 * addresses turns this endpoint into an account-existence oracle.
 */
export async function issueLoginToken(
  env: Env,
  email: string,
  native?: NativeAuthRequest,
): Promise<IssueResult> {
  return withUser(env, async (sql) => {
    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from login_token
       where email = ${email} and consumed_at is null and expires_at > now()
    `;
    if (Number(count) >= MAX_OUTSTANDING) return { token: null };

    const token = mintToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await sql`
      insert into login_token (
        token_hash, email, expires_at, native_state, native_code_challenge
      )
      values (
        ${await hashToken(token)}, ${email}, ${expiresAt},
        ${native?.state ?? null}, ${native?.codeChallenge ?? null}
      )
    `;
    return { token };
  });
}

export interface Session {
  token: string;
  userId: string;
  email: string;
  expiresAt: Date;
  /** True when this sign-in made the account rather than returning to
      it. All three doors are upserts; the flag is read off the same
      statement (`xmax = 0`), never guessed from a lookup before it. */
  created: boolean;
  /** Present only when a magic-link request began in the native app. */
  native?: NativeAuthRequest;
}

/**
 * The first authenticated destination is derived from server state, never a
 * browser-supplied return URL. A user without membership is new and must land
 * in onboarding, where RepositoryGate creates the business and Activate Jentera
 * durably starts its Hermes runtime. Existing members resume the first
 * unfinished stage instead of relying on a later client-side bounce.
 */
export type AuthLandingPath = '/onboard' | '/setup' | '/app' | '/access';

export async function authLandingPath(env: Env, userId: string): Promise<AuthLandingPath> {
  if (restrictedAccess(env)) {
    const email = await withUser(env, async sql => {
      const [user] = await sql<{ email: string }[]>`select email from app_user where id = ${userId} and email_verified = true`;
      return user?.email;
    });
    if (!email || !(await accessForEmail(env, email)).allowed) return '/access';
  }
  const businessId = await withUser(env, async (sql) => {
    /* The same rule as verifySession: a staff seat counts only while the
       business is on the team plan (business_plan is the definer helper,
       migration 038, because business is RLS-protected out here). */
    const [membership] = await sql<{ business_id: string }[]>`
      select business_id from membership
       where user_id = ${userId}
         and (role = 'owner' or public.business_plan(business_id) = 'team')
       order by created_at limit 1`;
    return membership?.business_id ?? null;
  });
  if (!businessId) return '/onboard';

  /* business is RLS-protected, so it must not be joined into the pre-tenant
     membership lookup above. Resolve the id first, then read the two flow
     gates inside the tenant transaction they belong to. */
  return withTenant(env, businessId, async (tx) => {
    const [business] = await tx<{ onboarded: boolean; setup_done: boolean }[]>`
      select onboarded, setup_done from business where id = ${businessId}`;
    if (!business?.onboarded) return '/onboard';
    return business.setup_done ? '/app' : '/setup';
  });
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
    const rows = await sql<{
      email: string;
      native_state: string | null;
      native_code_challenge: string | null;
    }[]>`
      update login_token
         set consumed_at = now()
       where token_hash = ${tokenHash}
         and consumed_at is null
         and expires_at > now()
      returning email, native_state, native_code_challenge
    `;
    if (rows.length === 0) return null;

    const email = rows[0].email;

    /* Consuming the link IS the proof of address ownership, so this is
       where email_verified becomes true — including for an account that
       was created by password signup and has been waiting for it.

       The password is the exception, and it mirrors the Google claim
       below: a password on a still-unverified account was set by whoever
       signed up on this address, which is not necessarily the person who
       just proved they own it. Verifying the address must not activate
       that password. A verified owner keeps theirs. */
    const [user] = await sql<{ id: string; created: boolean }[]>`
      insert into app_user (email, last_seen_at, email_verified)
      values (${email}, now(), true)
      on conflict (email) do update
        set last_seen_at = now(),
            email_verified = true,
            password_hash = case when app_user.email_verified
                                 then app_user.password_hash
                                 else null end
      returning id, (xmax = 0) as created
    `;

    const session = await startSession(sql, user.id, email, user.created);
    const native = rows[0].native_state && rows[0].native_code_challenge
      ? {
          state: rows[0].native_state,
          codeChallenge: rows[0].native_code_challenge,
        }
      : undefined;
    return native ? { ...session, native } : session;
  });
}

/**
 * Mint a session row and return the bearer half.
 *
 * Shared by every way in — link, password, Google — so all three
 * produce sessions with identical lifetime and storage. Only hashes
 * are written; the returned token exists nowhere but the cookie.
 */
async function startSession(
  sql: postgres.Sql | postgres.TransactionSql,
  userId: string,
  email: string,
  created = false,
  kind: SessionKind = 'web',
): Promise<Session> {
  const sessionToken = mintToken();
  const expiresAt = new Date(Date.now() + (kind === 'native' ? NATIVE_SESSION_TTL_MS : SESSION_TTL_MS));
  await sql`
    insert into session (id, user_id, expires_at, kind)
    values (${await hashToken(sessionToken)}, ${userId}, ${expiresAt}, ${kind})
  `;
  return { token: sessionToken, userId, email, expiresAt, created };
}

/**
 * Turn a live browser session into a one-time, PKCE-bound native code.
 *
 * verifyIdentitySession establishes the user and accessForEmail enforces the
 * launch gate. The INSERT ... SELECT then rechecks that the exact source
 * session is still live and the address verified, closing the revocation
 * race between those checks and the write.
 */
export async function issueNativeCode(
  env: Env,
  sessionToken: string,
  input: { state: string; codeChallenge: string },
): Promise<string | null> {
  const identity = await verifyIdentitySession(env, sessionToken);
  if (!identity || !(await accessForEmail(env, identity.email)).allowed) return null;

  const code = mintToken();
  const codeId = await hashToken(code);
  const sessionId = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + NATIVE_CODE_TTL_MS);
  return withUser(env, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      insert into native_auth_code (
        id, user_id, session_id, code_challenge, state, expires_at
      )
      select ${codeId}, s.user_id, s.id, ${input.codeChallenge}, ${input.state}, ${expiresAt}
        from session s
        join app_user u on u.id = s.user_id
       where s.id = ${sessionId}
         and s.user_id = ${identity.userId}
         and s.revoked_at is null
         and s.expires_at > now()
         and u.email_verified = true
      returning id`;
    return rows.length === 1 ? code : null;
  });
}

/** PKCE S256: base64url(SHA-256(verifier)), without padding. */
async function nativeCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

/**
 * Spend a native code and mint a separate session for the phone.
 *
 * The conditional UPDATE is the single-use lock. A bad state or verifier
 * deliberately consumes the code: an intercepted callback gets one guess,
 * while a successful exchange and its new session commit atomically.
 */
export async function redeemNativeCode(
  env: Env,
  input: { code: string; state: string; codeVerifier: string },
): Promise<Session | null> {
  const codeId = await hashToken(input.code);
  const challenge = await nativeCodeChallenge(input.codeVerifier);
  return withUser(env, async (sql) => {
    const result = await sql.begin(async (tx) => {
      const rows = await tx<{
        user_id: string;
        session_id: string;
        code_challenge: string;
        state: string;
      }[]>`
        update native_auth_code
           set consumed_at = now()
         where id = ${codeId}
           and consumed_at is null
           and expires_at > now()
        returning user_id, session_id, code_challenge, state`;
      if (rows.length !== 1) return null;

      const code = rows[0];
      if (code.state !== input.state || code.code_challenge !== challenge) return null;

      const [source] = await tx<{ email: string }[]>`
        select u.email
          from session s
          join app_user u on u.id = s.user_id
         where s.id = ${code.session_id}
           and s.user_id = ${code.user_id}
           and s.revoked_at is null
           and s.expires_at > now()
           and u.email_verified = true`;
      if (!source) return null;

      /* Marked native and short-lived: this token leaves the browser and
         lives in the app's keystore, where nothing but its expiry bounds a
         leak until there is a devices list to revoke it from. */
      return startSession(tx, code.user_id, source.email, false, 'native');
    });
    return result as Session | null;
  });
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
    return startSession(sql, user.id, email);
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
    const { userId, created } = await claimGoogleIdentity(sql, profile);
    return startSession(sql, userId, profile.email, created);
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
): Promise<{ userId: string; created: boolean }> {
  {
    const [linked] = await sql<{ user_id: string }[]>`
      select user_id from oauth_identity
       where provider = 'google' and subject = ${profile.subject}
    `;

    let userId: string;
    let created = false;
    if (linked) {
      userId = linked.user_id;
      await sql`update app_user set last_seen_at = now() where id = ${userId}`;
    } else {
      const [user] = await sql<{ id: string; email_verified: boolean; created: boolean }[]>`
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
        returning id, email_verified, (xmax = 0) as created
      `;
      userId = user.id;
      created = user.created;
      await sql`
        insert into oauth_identity (provider, subject, user_id, email)
        values ('google', ${profile.subject}, ${userId}, ${profile.email})
        on conflict (provider, subject) do nothing
      `;
    }

    return { userId, created };
  }
}

export interface Identity {
  userId: string;
  email: string;
  businessId: string | null;
  role: 'owner' | 'staff' | null;
  /** 'advanced' shows the technical trace and the raw operation names.
      A property of the person, not the business: two people running one
      shop need not want the same amount of detail. */
  detailLevel: 'beginner' | 'advanced';
}

/** Resolve a session cookie to an identity, or null. */
export async function verifySession(env: Env, token: string): Promise<Identity | null> {
  const identity = await verifyIdentitySession(env, token);
  if (identity && !(await accessForEmail(env, identity.email)).allowed) return null;
  return identity;
}

/** Authentication only, for the access page and code redemption; never product routes. */
export async function verifyIdentitySession(env: Env, token: string): Promise<Identity | null> {
  const id = await hashToken(token);
  return withUser(env, async (sql) => {
    const rows = await sql<
      {
        user_id: string;
        email: string;
        business_id: string | null;
        role: string | null;
        detail_level: string;
      }[]
    >`
      select s.user_id, u.email, u.detail_level, m.business_id, m.role
        from session s
        join app_user u on u.id = s.user_id
        left join membership m on m.user_id = s.user_id
         and (m.role = 'owner' or public.business_plan(m.business_id) = 'team')
       where s.id = ${id}
         and s.revoked_at is null
         and s.expires_at > now()
         and (${!restrictedAccess(env)} or u.email_verified = true)
       order by case m.role when 'owner' then 0 when 'staff' then 1 else 2 end,
                m.business_id
       limit 1
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      userId: r.user_id,
      email: r.email,
      businessId: r.business_id,
      role: (r.role as 'owner' | 'staff' | null) ?? null,
      detailLevel: r.detail_level === 'advanced' ? 'advanced' : 'beginner',
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

/**
 * The session token a request carries, from either supported transport.
 *
 * Header before cookie, deliberately: the native app's WebView shares
 * Android's system cookie jar, so a stale cookie from a previous sign-in
 * must not shadow the bearer the app actually holds. Browser requests keep
 * using the HttpOnly cookie unchanged.
 */
export function readSessionToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization');
  /* Present but malformed is a refusal, not a fallback to the cookie.
     Falling through would reintroduce the shadowing this function exists to
     prevent: Android's WebView shares the system cookie jar, so `Bearer `
     with an empty token would quietly authenticate as whoever the cookie
     says — which is not who the app thinks it is. */
  if (authorization !== null) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization);
    return bearer ? bearer[1] : null;
  }
  return readCookie(request);
}

/** Change how much detail this person wants to see. */
export async function setDetailLevel(
  env: Env,
  userId: string,
  level: 'beginner' | 'advanced',
): Promise<void> {
  await withUser(env, async (sql) => {
    await sql`update app_user set detail_level = ${level} where id = ${userId}`;
  });
}
