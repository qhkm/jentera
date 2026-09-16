import type { Env } from '../env';
import { resolveTenant } from '../tenancy';
import { originAllowed } from '../request-guard';
import { requestDeletion } from '../account-deletion/request';
import { GRACE_DAYS } from '../account-deletion/store';
import { sendNotice } from '../email';
import { hashToken, mintToken } from '../auth';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

export async function handleAccount(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== '/api/me' || request.method !== 'DELETE') return null;
  if (!originAllowed(request, cors)) {
    return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
  }
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'sign in first' }, { status: 401 }, cors);

  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const confirmEmail = typeof body.email === 'string' ? body.email : '';

  const value = mintToken();
  const result = await requestDeletion(env, identity, confirmEmail, {
    id: await hashToken(value),
    value,
  });
  if (result.status !== 200) {
    return json({ ok: false, err: result.err }, { status: result.status }, cors);
  }

  /* Outside the transaction requestDeletion already committed: Resend is an
     external service, and nothing here can be allowed to hold that
     transaction open waiting on it. */
  const cancelUrl = `${env.API_ORIGIN}/api/account/restore?token=${value}`;
  await sendNotice(
    env,
    identity.email,
    'Your Jentera account is being deleted',
    `You asked us to delete your Jentera account.\n\n` +
      `You have been signed out everywhere. Your data is erased in ${GRACE_DAYS} days.\n\n` +
      `Changed your mind? Keep the account: ${cancelUrl}\n\n` +
      `This link works once, and only until the ${GRACE_DAYS} days are up.`,
  );

  return json({ ok: true, graceDays: GRACE_DAYS, routines: result.routines }, {}, cors);
}
