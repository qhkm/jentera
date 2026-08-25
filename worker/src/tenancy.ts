/* ============================================================
   The single source of tenant identity.

   Before this existed, `business` came from the request body, so any
   caller could read or approve another tenant's queue — the hole
   worker/README.md documented. Nothing else in this Worker may produce
   a business id. No route may read one from a body, query string or
   header.
   ============================================================ */

import type { Env } from './env';
import { readCookie, verifySession, type Identity } from './auth';

export type { Identity };

/**
 * Resolve a request to an identity, or null when unauthenticated.
 *
 * Deliberately queries only session, app_user and membership — never the
 * `business` table. Those three carry no RLS policy precisely because
 * this lookup runs *before* a tenant is known; joining a policy-protected
 * table here would return nothing and lock everyone out.
 */
export async function resolveTenant(env: Env, request: Request): Promise<Identity | null> {
  const token = readCookie(request);
  if (!token) return null;
  return verifySession(env, token);
}

/** Identity that is signed in AND has a business. */
export interface TenantIdentity extends Identity {
  businessId: string;
}

export function hasBusiness(identity: Identity | null): identity is TenantIdentity {
  return identity !== null && identity.businessId !== null;
}
