import { withUser } from './db';
import type { Env } from './env';
import { chatPreviewEnabled, previewForEmail, type ChatPreview } from './chat-preview';

import { ACCESS_OWNER } from './access-owner';
export { ACCESS_OWNER } from './access-owner';
export const TRIAL_HOURS = 72;
export const restrictedAccess = (env: Env) => env.ACCESS_MODE === 'waitlist';
export interface AccessStatus { allowed: boolean; kind: 'open' | 'owner' | 'paid' | 'trial' | 'preview' | 'waitlist'; expiresAt: string | null; preview?: ChatPreview }
export function grantActive(grant: { expires_at: Date | string | null; revoked_at: Date | string | null } | undefined, now = Date.now()): boolean {
  return !!grant && !grant.revoked_at && (grant.expires_at === null || new Date(grant.expires_at).getTime() > now);
}
/** Caller must establish verified identity before using this answer. */
export async function accessForEmail(env: Env, email: string): Promise<AccessStatus> {
  if (!restrictedAccess(env)) return { allowed: true, kind: 'open', expiresAt: null };
  if (email.toLowerCase() === ACCESS_OWNER) return { allowed: true, kind: 'owner', expiresAt: null };
  const grant = await withUser(env, async sql => {
    const [grant] = await sql<{ kind: 'paid' | 'trial'; expires_at: Date | null; revoked_at: Date | null }[]>`select kind, expires_at, revoked_at from platform_access where email = ${email.toLowerCase()}`;
    return grant;
  });
  if (!grant) {
    const preview = await previewForEmail(env, email);
    // Keep read access after exhaustion so the tenth answer can finish.
    if (preview) return { allowed: true, kind: 'preview', expiresAt: null, preview };
  }
  return { allowed: grantActive(grant), kind: grantActive(grant) ? grant!.kind : 'waitlist', expiresAt: grant?.expires_at?.toISOString() ?? null };
}
/** Background work is admitted only for a business with an eligible owner. */
export async function businessHasAccess(env: Env, businessId: string, previewTaskId: string | null = null): Promise<boolean> {
  if (!restrictedAccess(env)) return true;
  return withUser(env, async sql => {
    // Do not reference the preview table when the feature is off (safe rollback).
    const previewAccess = chatPreviewEnabled(env) && previewTaskId
      ? sql`a.email is null and exists(
          select 1 from chat_preview_request p where p.user_id=u.id and p.business_id=m.business_id
            and p.task_id=${previewTaskId}::uuid and p.status='created')`
      : sql`false`;
    const [row] = await sql<{ allowed: boolean }[]>`
      select exists (
        select 1 from membership m join app_user u on u.id = m.user_id
        left join platform_access a on a.email = lower(u.email)
        where m.business_id = ${businessId} and m.role = 'owner' and u.email_verified = true
        and (lower(u.email) = ${ACCESS_OWNER} or
          (a.revoked_at is null and a.email is not null and (a.expires_at is null or a.expires_at > now())) or
          (${previewAccess}))
      ) as allowed`;
    return row?.allowed === true;
  });
}
