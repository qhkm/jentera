/* ============================================================
   Postgres access.

   Every tenant-scoped query goes through `withTenant`. Nothing else
   may set app.business_id, and no route may take a business id from
   a request body — that was the hole this replaces.
   ============================================================ */

import postgres from 'postgres';
import type { Env } from './env';

export function connect(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    // Hyperdrive pools connections; per-connection type introspection is
    // wasted work and an extra round trip on every cold start.
    fetch_types: false,
  });
}

/**
 * Run `fn` inside a transaction scoped to one business.
 *
 * `set_config(..., true)` is transaction-local. That granularity is not a
 * detail — Hyperdrive pools connections, so setting the GUC per connection
 * would leak one tenant's scope into the next request that reused it.
 * Verified against the pooled endpoint on 2026-08-25: the value is gone
 * after COMMIT, while the same call with local=false persists.
 */
export async function withTenant<T>(
  env: Env,
  businessId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const sql = connect(env);
  try {
    return await sql.begin(async (tx) => {
      await tx`select set_config('app.business_id', ${businessId}, true)`;
      return fn(tx);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** For queries that precede tenant resolution: login, session lookup. */
export async function withUser<T>(
  env: Env,
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = connect(env);
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
