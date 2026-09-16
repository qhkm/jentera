import type { Env } from '../env';
import { resolveTenant } from '../tenancy';
import { originAllowed } from '../request-guard';
import { requestDeletion } from '../account-deletion/request';
import { GRACE_DAYS } from '../account-deletion/store';
import { sendNotice } from '../email';
import { hashToken, mintToken } from '../auth';
import { withUser, withTenant } from '../db';

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
  if (url.pathname === '/api/account/restore' && request.method === 'GET') {
    /* A GET that mutates, because it arrives from an email — the same shape
       as the magic link, single-use through a conditional UPDATE. There is
       nowhere in the app to put a cancel button: a deleted account cannot
       sign in. */
    const presented = url.searchParams.get('token') ?? '';
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(presented)) {
      return Response.redirect(`${env.APP_ORIGIN}/signin?error=restore-failed`, 302);
    }
    const id = await hashToken(presented);

    /* First, try the conditional UPDATE that guards single-use. This runs
       outside a tenant transaction because account_deletion has no RLS. */
    const record = await withUser(env, async (sql) => {
      const rows = await sql<{ user_id: string; business_id: string | null }[]>`
        update account_deletion
           set cancelled_at = now()
         where cancel_token_id = ${id}
           and cancelled_at is null
           and completed_at is null
           and stage = 'pending'
           and scheduled_for > now()
        returning user_id, business_id`;
      return rows.length === 0 ? null : rows[0];
    });

    if (!record) {
      return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    }

    /* Now restore the user and business. Both updates must run inside a
       tenant transaction because business has forced RLS. */
    if (record.business_id) {
      await withTenant(env, record.business_id, async (tx) => {
        await tx`update app_user set deleted_at = null where id = ${record.user_id}`;
        await tx`update business set deleted_at = null where id = ${record.business_id}`;
      });
    } else {
      /* Staff deletion: no business to restore. Update the user outside a
         tenant context. */
      await withUser(env, async (sql) => {
        await sql`update app_user set deleted_at = null where id = ${record.user_id}`;
      });
    }

    return Response.redirect(`${env.APP_ORIGIN}/signin?restored=1`, 302);
  }

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
