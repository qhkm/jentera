/* ============================================================
   Postgres access.

   Every tenant-scoped query goes through `withTenant`. Nothing else
   may set app.business_id, and no route may take a business id from
   a request body — that was the hole this replaces.
   ============================================================ */

import postgres from 'postgres';
import type { Env } from './env';

/* One postgres.js client per isolate, keyed by connection string. Creating
   a client per call costs a TCP+TLS handshake to Hyperdrive on every tenant
   query (webhook insert, lease, credential, renewals…); reuse keeps the
   pooled socket warm across requests and the consumer stream's renewals.
   Hyperdrive pools origin connections server-side, so the JS-side pool is
   small; isolate eviction cleans the client up. */
const clients = new Map<string, postgres.Sql<{}>>();

export function connect(env: Env): postgres.Sql<{}> {
  const url = env.HYPERDRIVE.connectionString;
  let sql = clients.get(url);
  if (!sql) {
    sql = postgres(url, {
      max: 5,
      // Hyperdrive pools connections; per-connection type introspection is
      // wasted work and an extra round trip on every cold start.
      fetch_types: false,
    });
    clients.set(url, sql);
  }
  return sql;
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
  // The client is memoized per isolate; no sql.end() — tearing it down would
  // defeat the reuse. Isolate eviction handles cleanup.
  const out = await sql.begin(async (tx) => {
    await tx`select set_config('app.business_id', ${businessId}, true)`;
    return fn(tx);
  });
  return out as T;
}

/** For queries that precede tenant resolution: login, session lookup. */
export async function withUser<T>(
  env: Env,
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = connect(env);
  return fn(sql);
}
