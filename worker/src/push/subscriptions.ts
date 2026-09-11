import type postgres from 'postgres';

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Postgres error code for a unique violation: here, an endpoint another
    tenant's row already holds, which RLS keeps out of sight. */
export const UNIQUE_VIOLATION = '23505';

/** Insert or refresh a browser's subscription for this owner. Within the
    tenant the endpoint's row is updated in place; across tenants the
    insert conflicts with a row RLS hides, and the caller turns that into
    a 409 so the browser takes a new endpoint. */
export async function savePushSubscription(
  tx: postgres.TransactionSql,
  businessId: string,
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  await tx`
    insert into push_subscription (business_id, user_id, endpoint, p256dh, auth, user_agent)
    values (${businessId}, ${userId}, ${input.endpoint}, ${input.p256dh}, ${input.auth},
            ${input.userAgent?.slice(0, 300) ?? null})
    on conflict (endpoint) do update
      set user_id = excluded.user_id,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          updated_at = now()`;
}

export async function deletePushSubscription(
  tx: postgres.TransactionSql,
  businessId: string,
  userId: string,
  endpoint: string,
): Promise<void> {
  await tx`
    delete from push_subscription
     where business_id = ${businessId} and user_id = ${userId} and endpoint = ${endpoint}`;
}

export async function listPushSubscriptions(
  tx: postgres.TransactionSql,
  businessId: string,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return tx<PushSubscriptionRow[]>`
    select id, endpoint, p256dh, auth from push_subscription
     where business_id = ${businessId} and user_id = ${userId}
     order by created_at`;
}

/** The push service said the subscription no longer exists (404 or 410). */
export async function forgetPushSubscriptions(
  tx: postgres.TransactionSql,
  businessId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx`delete from push_subscription where business_id = ${businessId} and id in ${tx(ids)}`;
}

export async function touchPushSubscriptions(
  tx: postgres.TransactionSql,
  businessId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx`update push_subscription set last_used_at = now()
            where business_id = ${businessId} and id in ${tx(ids)}`;
}
