import { withUser } from './db';
import type { Env } from './env';

export const ACCESS_OWNER = 'qhkmdev90@gmail.com';
export const TRIAL_HOURS = 72;
export const restrictedAccess = (env: Env) => env.ACCESS_MODE === 'waitlist';
export interface AccessStatus { allowed: boolean; kind: 'open' | 'owner' | 'paid' | 'trial' | 'waitlist'; expiresAt: string | null }
export function grantActive(grant: { expires_at: Date | string | null; revoked_at: Date | string | null } | undefined, now = Date.now()): boolean {
  return !!grant && !grant.revoked_at && (grant.expires_at === null || new Date(grant.expires_at).getTime() > now);
}
/** Caller must establish verified identity before using this answer. */
export async function accessForEmail(env: Env, email: string): Promise<AccessStatus> {
  if (!restrictedAccess(env)) return { allowed: true, kind: 'open', expiresAt: null };
  if (email.toLowerCase() === ACCESS_OWNER) return { allowed: true, kind: 'owner', expiresAt: null };
  return withUser(env, async sql => {
    const [grant] = await sql<{ kind: 'paid' | 'trial'; expires_at: Date | null; revoked_at: Date | null }[]>`select kind, expires_at, revoked_at from platform_access where email = ${email.toLowerCase()}`;
    return { allowed: grantActive(grant), kind: grantActive(grant) ? grant.kind : 'waitlist', expiresAt: grant?.expires_at?.toISOString() ?? null };
  });
}
/** Background work is admitted only for a business with an eligible owner. */
export async function businessHasAccess(env: Env, businessId: string): Promise<boolean> {
  if (!restrictedAccess(env)) return true;
  return withUser(env, async sql => {
    const [row] = await sql<{ allowed: boolean }[]>`
      select exists (
        select 1 from membership m join app_user u on u.id = m.user_id
        left join platform_access a on a.email = lower(u.email)
        where m.business_id = ${businessId} and m.role = 'owner' and u.email_verified = true
        and (lower(u.email) = ${ACCESS_OWNER} or
          (a.revoked_at is null and a.email is not null and (a.expires_at is null or a.expires_at > now())))
      ) as allowed`;
    return row?.allowed === true;
  });
}
