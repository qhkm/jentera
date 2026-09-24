/* Who a notification is for, by role. Owners decide approvals and settle
   tasks that wait on the owner, so owner-facing events go to every owner.
   The one who asked is left out here and told separately by `work.ts`,
   with their own wording, and only when they asked in the app: in a
   business of one person that is the only person told. */
import type postgres from 'postgres';

export async function ownersOf(
  tx: postgres.TransactionSql,
  businessId: string,
  options: { except?: string | null } = {},
): Promise<string[]> {
  const rows = await tx<{ user_id: string }[]>`
    select user_id from membership
     where business_id = ${businessId} and role = 'owner'
       and (${options.except ?? null}::uuid is null or user_id <> ${options.except ?? null}::uuid)
     order by created_at`;
  return rows.map((row) => row.user_id);
}
