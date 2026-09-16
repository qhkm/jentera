import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, type Identity, type TenantIdentity } from '../tenancy';
import { DEFAULT_SPECIALISTS } from '../specialists';

/** A billing identity is not product access. Creation does not provision
 * compute, confirm onboarding, grant credits or activate a subscription. */
export async function ensureBillingOwner(env: Env, identity: Identity): Promise<TenantIdentity | null> {
  if (hasBusiness(identity)) return identity.role === 'owner' ? identity : null;
  const candidate = crypto.randomUUID();
  const owner = await withTenant(env, candidate, async tx => {
    // Uses the same user-row lock as normal onboarding: two pre-membership
    // sessions cannot create different businesses for the same paying account.
    const [user] = await tx`select id, email_verified from app_user where id=${identity.userId} for update`;
    if (!user?.email_verified) return null;
    const [access] = await tx`select revoked_at from platform_access where email=${identity.email.toLowerCase()}`;
    if (access?.revoked_at) return null;
    const [membership] = await tx`select business_id, role from membership where user_id=${identity.userId}
      order by case role when 'owner' then 0 else 1 end, business_id limit 1`;
    if (membership) return membership.role === 'owner' ? String(membership.business_id) : null;
    await tx`insert into business (id, name, playbook_key, country, lang)
      values (${candidate}, 'My business', 'generic', 'MY', 'en')`;
    await tx`insert into membership (business_id, user_id, role) values (${candidate}, ${identity.userId}, 'owner')`;
    for (const [sort, specialist] of DEFAULT_SPECIALISTS.entries()) {
      await tx`insert into specialist_profile (business_id, profile_key, name, description, sort_order)
        values (${candidate}, ${specialist.profile}, ${specialist.name}, ${specialist.description}, ${(sort + 1) * 10})`;
    }
    return candidate;
  });
  return owner ? { ...identity, businessId: owner, role: 'owner' } : null;
}
