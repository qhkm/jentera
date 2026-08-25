import type { Env } from '../env';
import {
  clearedCookie,
  consumeLoginToken,
  issueLoginToken,
  readCookie,
  revokeSession,
  sessionCookie,
  verifySession,
} from '../auth';
import { sendMagicLink } from '../email';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

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

    /* 204 for everything, including a malformed address and a
       rate-limited one. Any other answer turns this into an
       account-existence oracle. */
    if (EMAIL.test(addr)) {
      const { token } = await issueLoginToken(env, addr);
      if (token) {
        const link = `${env.APP_ORIGIN}/api/auth/consume?token=${encodeURIComponent(token)}`;
        await sendMagicLink(env, addr, link);
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
        Location: `${env.APP_ORIGIN}/app`,
        'Set-Cookie': sessionCookie(session.token, session.expiresAt),
      },
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
