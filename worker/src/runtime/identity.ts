/* ============================================================
   Who is asking — for a caller that is a sprite, not a person.

   Every other authenticated route starts from a session cookie and knows
   its tenant before it touches the database. A runtime does not: it holds
   a derived `sk-jentera-v1.…` credential whose only tenant-shaped claim is
   the rider id, and the row that maps rider to business is behind RLS,
   which scopes it to nothing outside `withTenant`. So identification is
   one narrow SECURITY DEFINER call (migration 027) and everything after it
   happens under the tenant it returns.

   The credential is the one already in `hermes.env` as OPENROUTER_API_KEY,
   deliberately: a brand-new secret would need a new bootstrap transfer
   field, and shipping one of those is the trap this whole plan exists to
   close. The widened blast radius — a leaked model credential now also
   reads that rider's configuration — is real, is written down in the plan's
   section 8, and is accepted only because the credential already shares a
   0600 file with every other secret the sprite holds.
   ============================================================ */

import type { Env } from '../env';
import { connect } from '../db';
import {
  JenteraKeyError,
  JenteraKeyUnavailableError,
  verifyJenteraKey,
  type JenteraKeyClaims,
} from '../fmcv-verifier';

export class RuntimeIdentityError extends Error {
  constructor(readonly status: 401 | 403 | 503, message: string) {
    super(message);
  }
}

export interface RuntimeIdentity {
  businessId: string;
  claims: JenteraKeyClaims;
}

function bearer(request: Request): string {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * The business a runtime credential speaks for, or a typed refusal.
 *
 * Verification is stateless; the single query is ids in, id out. A rider
 * whose runtime has been deleted resolves to nothing and is refused with
 * 403 rather than 401 — the credential was real, the runtime is gone, and
 * telling those apart is what makes a revoked sprite legible in the logs.
 */
export async function resolveRuntimeIdentity(
  env: Env,
  request: Request,
): Promise<RuntimeIdentity> {
  let claims: JenteraKeyClaims;
  try {
    claims = await verifyJenteraKey(bearer(request), env.AISAR_MODEL_KEY?.trim() ?? '');
  } catch (err) {
    if (err instanceof JenteraKeyUnavailableError) {
      throw new RuntimeIdentityError(503, 'model control secret is not configured');
    }
    if (err instanceof JenteraKeyError) {
      throw new RuntimeIdentityError(401, 'runtime credential is invalid');
    }
    throw err;
  }

  const sql = connect(env);
  try {
    const [row] = await sql<{ business_id: string | null }[]>`
      select public.runtime_business_for_rider(${claims.rid}) as business_id`;
    const businessId = row?.business_id ?? null;
    if (!businessId) throw new RuntimeIdentityError(403, 'runtime is not provisioned');
    return { businessId, claims };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}
