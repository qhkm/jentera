import type postgres from 'postgres';

/** Seven days. The one place this number lives. */
export const GRACE_DAYS = 7;

export interface DeletionRecord {
  id: string;
  /* Which of the two operations this is. Every stage branches on it: an
     owner's deletion takes the business with it, a staff member's must
     leave the business exactly as it was, minus them. */
  businessId: string | null;
  userId: string | null;
  email: string;
  kind: 'owner' | 'staff';
  stage: 'pending' | 'connectors' | 'objects' | 'sprite' | 'tenant' | 'identity' | 'done' | 'stalled';
  attempts: number;
  artifactKeys: string[];
  spriteId: string | null;
  connectorIds: string[];
}

/** What the person is about to lose, in numbers they can check. */
export async function deletionConsequences(
  tx: postgres.TransactionSql,
  businessId: string,
  userId: string,
): Promise<{ routines: number }> {
  const [row] = await tx<{ routines: number }[]>`
    select count(*)::int as routines from routine
     where business_id = ${businessId} and created_by = ${userId}`;
  return { routines: row?.routines ?? 0 };
}

/**
 * The identifiers the cascade is about to erase. Read before anything dies.
 *
 * The runtime's sprite identity is `agent_runtime.provider_name` — the
 * `unique (provider, provider_name)` column, not the nullable `provider_id`
 * — because it is the one guaranteed to name the sprite regardless of which
 * provider fields a given runtime happened to fill in.
 */
export async function externalIdentifiers(
  tx: postgres.TransactionSql,
  businessId: string,
): Promise<{ artifactKeys: string[]; spriteId: string | null; connectorIds: string[] }> {
  const artifacts = await tx<{ r2_key: string }[]>`
    select r2_key from artifact where business_id = ${businessId}`;
  const runtimes = await tx<{ provider_name: string }[]>`
    select provider_name from agent_runtime where business_id = ${businessId}`;
  const connectors = await tx<{ id: string }[]>`
    select id from connection where business_id = ${businessId}`;
  return {
    artifactKeys: artifacts.map((a) => a.r2_key),
    spriteId: runtimes[0]?.provider_name ?? null,
    connectorIds: connectors.map((c) => c.id),
  };
}
