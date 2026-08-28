import type { Env } from '../env';
import {
  clearedCookie,
  consumeLoginToken,
  issueLoginToken,
  readCookie,
  revokeSession,
  sessionCookie,
  verifySession,
  authLandingPath,
  loginWithPassword,
  setDetailLevel,
  setPassword,
  signInWithGoogle,
  signUpWithPassword,
} from '../auth';
import { sendMagicLink } from '../email';
import { checkAuthRate, checkLoginBurst } from '../ratelimit';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from '../password';
import {
  authorizeUrl,
  exchangeCode,
  googleConfigured,
  randomUrlSafe,
  s256,
} from '../oauth';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

const noContentCors = (headers: Record<string, string>) =>
  new Response(null, { status: 204, headers });

const badRequest = (cors: Record<string, string>, err: string) =>
  json({ ok: false, err }, { status: 400 }, cors);

/** Short-lived holder for the OAuth state and PKCE verifier. Scoped to
    /api/auth so it is not sent on ordinary API calls. */
const OAUTH_COOKIE = 'aisar_oauth';

function readNamedCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

/** Returns null when the path is not ours, so the caller can fall through. */
export async function handleSession(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  /* ---- request a link ---------------------------------------------- */
  if (url.pathname === '/api/auth/request' && request.method === 'POST') {
    const { email } = (await request.json().catch(() => ({}))) as { email?: string };
    const addr = (email ?? '').trim().toLowerCase();

    /* 204 for a malformed or unknown address, always. Any other
       answer turns this into an account-existence oracle.

       Throttling splits from that rule, and the split is the point:

       - Over an IP limit answers 429. It reveals only the caller's own
         request volume, which they already know, and a silent refusal
         would leave a legitimate user retrying into a void.
       - Over the per-address limit answers 204. That counter includes
         requests made by ANYONE for that address, so a 429 would tell
         an attacker that somebody else has been asking for links to
         it. Silence costs the rare over-eager user a confusing minute;
         a 429 would leak third-party activity. */
    if (EMAIL.test(addr)) {
      const verdict = await checkAuthRate(env, request, addr);
      if (verdict === 'throttled-ip') {
        return new Response(null, {
          status: 429,
          headers: { ...cors, 'Retry-After': '60' },
        });
      }
      if (verdict === 'ok') {
        const { token } = await issueLoginToken(env, addr);
        if (token) {
          const link = `${env.APP_ORIGIN}/api/auth/consume?token=${encodeURIComponent(token)}`;
          await sendMagicLink(env, addr, link);
        }
      }
    }
    return new Response(null, { status: 204, headers: cors });
  }

  /* ---- follow the link --------------------------------------------- */
  if (url.pathname === '/api/auth/consume' && request.method === 'GET') {
    const token = url.searchParams.get('token') ?? '';
    const session = token ? await consumeLoginToken(env, token) : null;

    /* Expired, replayed and never-existed all land here identically.
       Distinguishing them would leak which tokens were once real. */
    if (!session) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${env.APP_ORIGIN}/signin?error=expired` },
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${env.APP_ORIGIN}${await authLandingPath(env, session.userId)}`,
        'Set-Cookie': sessionCookie(session.token, session.expiresAt),
      },
    });
  }

  /* ---- password: sign up --------------------------------------------- */

  if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const addr = (body.email ?? '').trim().toLowerCase();
    const problem = passwordProblem(body.password);

    /* Password shape is the caller's own mistake and safe to report.
       Anything about the ADDRESS is not — see below. */
    if (problem) return json({ ok: false, err: problem }, { status: 400 }, cors);
    if (!EMAIL.test(addr)) return json({ ok: false, err: 'invalid email' }, { status: 400 }, cors);

    const verdict = await checkAuthRate(env, request, addr);
    if (verdict === 'throttled-ip') {
      return new Response(null, { status: 429, headers: { ...cors, 'Retry-After': '60' } });
    }

    if (verdict === 'ok') {
      const outcome = await signUpWithPassword(env, addr, await hashPassword(body.password!));
      /* Either way a link goes to the address, and either way the
         answer below is the same. On 'created' the link verifies the
         new account; on 'exists' it is an ordinary sign-in link for
         whoever actually owns the address — which is the point. A
         signup attempt on someone else's address must not tell its
         author that the account is taken, and must not disturb it. */
      const { token } = await issueLoginToken(env, addr);
      if (token) {
        const link = `${env.APP_ORIGIN}/api/auth/consume?token=${encodeURIComponent(token)}`;
        await sendMagicLink(env, addr, link, outcome === 'created' ? 'verify' : 'exists');
      }
    }

    /* 202, not 201: nothing is usable yet. The account does not work
       until the link is followed, and saying "created" would be a lie
       on the 'exists' path anyway. */
    return json({ ok: true, next: 'check-email' }, { status: 202 }, cors);
  }

  /* ---- password: sign in --------------------------------------------- */

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const addr = (body.email ?? '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL.test(addr) || !password) {
      return json({ ok: false, err: 'invalid credentials' }, { status: 401 }, cors);
    }

    if (!(await checkLoginBurst(env, request, addr))) {
      return new Response(null, { status: 429, headers: { ...cors, 'Retry-After': '60' } });
    }

    const result = await loginWithPassword(env, addr, password, verifyPassword, DUMMY_HASH);

    if (result === 'bad-credentials') {
      return json({ ok: false, err: 'invalid credentials' }, { status: 401 }, cors);
    }
    if (result === 'unverified') {
      /* Only reachable with a CORRECT password, so the caller already
         controls the account and learns nothing new. */
      return json(
        { ok: false, err: 'Check your email for the link that activates this account.',
          code: 'UNVERIFIED' },
        { status: 403 },
        cors,
      );
    }

    return json(
      { ok: true, next: await authLandingPath(env, result.userId) },
      { headers: { 'Set-Cookie': sessionCookie(result.token, result.expiresAt) } },
      cors,
    );
  }

  /* ---- how much detail to show ---------------------------------------- */

  if (url.pathname === '/api/me/detail-level' && request.method === 'POST') {
    const token = readCookie(request);
    const identity = token ? await verifySession(env, token) : null;
    if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);

    const body = (await request.json().catch(() => ({}))) as { level?: string };
    const level = body.level === 'advanced' ? 'advanced' : body.level === 'beginner' ? 'beginner' : null;
    if (!level) return badRequest(cors, 'level must be beginner or advanced');

    await setDetailLevel(env, identity.userId, level);
    return noContentCors(cors);
  }

  /* ---- password: set one on the signed-in account --------------------- */

  if (url.pathname === '/api/auth/password' && request.method === 'POST') {
    const token = readCookie(request);
    const identity = token ? await verifySession(env, token) : null;
    if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);

    const body = (await request.json().catch(() => ({}))) as { password?: string };
    const problem = passwordProblem(body.password);
    if (problem) return json({ ok: false, err: problem }, { status: 400 }, cors);

    /* How a magic-link or Google user acquires a password without ever
       proving the address twice: they are already authenticated. */
    await setPassword(env, identity.userId, await hashPassword(body.password!));
    return noContentCors(cors);
  }

  /* ---- google: start -------------------------------------------------- */

  if (url.pathname === '/api/auth/google' && request.method === 'GET') {
    /* This route is reached by a browser NAVIGATION, not by fetch, so
       an error body renders as raw JSON on a blank page. Bounce back to
       the sign-in screen instead and let it explain in words — the same
       shape as every other failure in this flow. */
    if (!googleConfigured(env)) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${env.APP_ORIGIN}/signin?error=google-unavailable` },
      });
    }
    const state = randomUrlSafe();
    const verifier = randomUrlSafe();

    /* state and verifier ride back in a cookie rather than a server
       table: the callback is the same browser, and this keeps the flow
       stateless. Lax survives the top-level GET Google navigates back
       with; Strict would not, and the flow would break on arrival. */
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl(env, { state, codeChallenge: await s256(verifier) }),
        'Set-Cookie': `${OAUTH_COOKIE}=${state}.${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600`,
      },
    });
  }

  /* ---- google: return ------------------------------------------------- */

  if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
    const fail = (why: string) =>
      new Response(null, {
        status: 302,
        headers: {
          Location: `${env.APP_ORIGIN}/signin?error=${why}`,
          'Set-Cookie': `${OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0`,
        },
      });

    if (!googleConfigured(env)) return fail('google-unavailable');

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const stash = readNamedCookie(request, OAUTH_COOKIE);
    const [wantState, verifier] = (stash ?? '').split('.');

    /* The CSRF check. Without it an attacker can hand a victim a
       callback URL carrying the ATTACKER's code, silently signing the
       victim into the attacker's account — where anything they then do
       is visible to its owner. */
    if (!code || !state || !wantState || state !== wantState || !verifier) {
      return fail('google-failed');
    }

    const profile = await exchangeCode(env, code, verifier);
    if (!profile) return fail('google-failed');

    /* An unverified Google address proves nothing, and this whole flow
       leans on Google's assertion of ownership to claim accounts. */
    if (!profile.emailVerified) return fail('google-unverified');

    const session = await signInWithGoogle(env, profile);
    return new Response(null, {
      status: 302,
      headers: [
        ['Location', `${env.APP_ORIGIN}${await authLandingPath(env, session.userId)}`],
        ['Set-Cookie', sessionCookie(session.token, session.expiresAt)],
        ['Set-Cookie', `${OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0`],
      ],
    });
  }

  /* ---- who am I ------------------------------------------------------ */
  if (url.pathname === '/api/me' && request.method === 'GET') {
    const token = readCookie(request);
    const identity = token ? await verifySession(env, token) : null;
    if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
    return json({ ok: true, ...identity }, {}, cors);
  }

  /* ---- sign out ------------------------------------------------------ */
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const token = readCookie(request);
    if (token) await revokeSession(env, token);
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Set-Cookie': clearedCookie() },
    });
  }

  return null;
}
