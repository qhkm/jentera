/* ============================================================
   Connecting, disconnecting, and using a business's own accounts.

   The credential is loaded only at the moment of use and never
   returned upward. `listConnections` deliberately reads a table with
   no secret in it, so the screen that shows what is connected cannot
   accidentally show what opens it.
   ============================================================ */

import type postgres from 'postgres';
import type { Env } from './env';
import { KEY_VERSION, open, seal } from './vault';

export interface ConnectionRow {
  id: string;
  connector: string;
  method: string;
  status: 'connected' | 'expired' | 'revoked' | 'error';
  displayName: string | null;
  externalId: string | null;
  connectedAt: Date;
  lastOkAt: Date | null;
  lastError: string | null;
}

interface Raw {
  id: string;
  connector: string;
  method: string;
  status: ConnectionRow['status'];
  display_name: string | null;
  external_id: string | null;
  connected_at: Date;
  last_ok_at: Date | null;
  last_error: string | null;
}

const toRow = (r: Raw): ConnectionRow => ({
  id: r.id,
  connector: r.connector,
  method: r.method,
  status: r.status,
  displayName: r.display_name,
  externalId: r.external_id,
  connectedAt: r.connected_at,
  lastOkAt: r.last_ok_at,
  lastError: r.last_error,
});

export async function listConnections(tx: postgres.TransactionSql): Promise<ConnectionRow[]> {
  const rows = await tx<Raw[]>`
    select id, connector, method, status, display_name, external_id,
           connected_at, last_ok_at, last_error
      from connection order by connected_at desc`;
  return rows.map(toRow);
}

/**
 * Store a connection and its secret together, or neither.
 *
 * One transaction because a connection without its credential is a row
 * claiming to be connected that cannot do anything — and it would look
 * fine on the connections screen, which reads only the metadata table.
 */
export async function saveConnection(
  env: Env,
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    connector: string;
    method: string;
    externalId: string;
    displayName: string;
    secret: string;
    connectedBy: string;
  },
): Promise<ConnectionRow> {
  const [row] = await tx<Raw[]>`
    insert into connection
      (business_id, connector, method, status, external_id, display_name, connected_by, last_ok_at)
    values
      (${businessId}, ${input.connector}, ${input.method}, 'connected',
       ${input.externalId}, ${input.displayName}, ${input.connectedBy}, now())
    on conflict (business_id, connector, external_id) do update
      set status = 'connected',
          display_name = excluded.display_name,
          connected_by = excluded.connected_by,
          connected_at = now(),
          last_ok_at = now(),
          -- Reconnecting is how an owner fixes a broken connection, so
          -- the old failure must not linger on a working one.
          last_error = null
    returning id, connector, method, status, display_name, external_id,
              connected_at, last_ok_at, last_error`;

  const sealed = await seal(env, input.secret);
  await tx`
    insert into credential (connection_id, ciphertext, key_version)
    values (${row.id}, ${sealed}, ${KEY_VERSION})
    on conflict (connection_id) do update
      set ciphertext = excluded.ciphertext,
          key_version = excluded.key_version,
          refreshed_at = now()`;

  return toRow(row);
}

/** The secret, for one use. Callers must not store what comes back. */
export async function useCredential(
  env: Env,
  tx: postgres.TransactionSql,
  connectionId: string,
): Promise<string> {
  const [row] = await tx<{ ciphertext: Uint8Array; key_version: number }[]>`
    select ciphertext, key_version from credential where connection_id = ${connectionId}`;
  if (!row) throw new Error('that connection has no credential');
  return open(env, row.ciphertext, row.key_version);
}

export async function findConnection(
  tx: postgres.TransactionSql,
  connector: string,
): Promise<ConnectionRow | null> {
  const [row] = await tx<Raw[]>`
    select id, connector, method, status, display_name, external_id,
           connected_at, last_ok_at, last_error
      from connection
     where connector = ${connector} and status = 'connected'
     order by connected_at desc limit 1`;
  return row ? toRow(row) : null;
}

/** Record that a connection stopped working, in words the owner can act on. */
export async function markBroken(
  tx: postgres.TransactionSql,
  connectionId: string,
  why: string,
): Promise<void> {
  await tx`
    update connection set status = 'error', last_error = ${why.slice(0, 500)}
     where id = ${connectionId}`;
}

export async function removeConnection(
  tx: postgres.TransactionSql,
  connectionId: string,
): Promise<boolean> {
  // credential cascades.
  const rows = await tx`delete from connection where id = ${connectionId} returning id`;
  return rows.length > 0;
}

/**
 * The per-connection webhook secret.
 *
 * Stored, not derived. Deriving it from CREDENTIAL_KEY coupled it to a
 * key that key_version exists to let us rotate — and a rotation would
 * have changed every secret while Telegram kept presenting the old
 * one, breaking every webhook with no symptom but silence.
 *
 * Generated once and returned on read, so a connection made before
 * this column existed gets one on next use rather than staying
 * mysteriously deaf.
 */
export async function webhookSecret(
  tx: postgres.TransactionSql,
  connectionId: string,
): Promise<string> {
  const [row] = await tx<{ webhook_secret: string | null }[]>`
    select webhook_secret from connection where id = ${connectionId}`;
  if (row?.webhook_secret) return row.webhook_secret;

  // Telegram allows A-Z a-z 0-9 _ - up to 256 characters.
  const fresh = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await tx`update connection set webhook_secret = ${fresh} where id = ${connectionId}`;
  return fresh;
}

export type WebhookVerdict =
  | { ok: true }
  | { ok: false; why: string };

/**
 * Decide whether an incoming webhook really came from the connector.
 *
 * Takes a transaction rather than an Env so the tests execute this
 * exact code. That matters more here than anywhere else in the Worker:
 * this is the only unauthenticated write path, and the one bug it has
 * already had was invisible from both ends — Telegram reported
 * successful delivery while every update was refused.
 *
 * The caller must already have opened the transaction scoped to the
 * business named in the URL. `connection` has RLS forced, so a read
 * with no app.business_id returns nothing and this returns a miss —
 * which is exactly how that bug behaved, and why there is a test for
 * it below rather than a comment.
 */
export async function verifyWebhook(
  tx: postgres.TransactionSql,
  connectionId: string,
  presented: string,
): Promise<WebhookVerdict> {
  const [row] = await tx<{ webhook_secret: string | null; status: string }[]>`
    select webhook_secret, status from connection where id = ${connectionId}`;

  if (!row) return { ok: false, why: 'no such connection for that business' };
  if (row.status !== 'connected') return { ok: false, why: `connection is ${row.status}` };

  const expected = row.webhook_secret ?? '';
  if (!expected) return { ok: false, why: 'no stored secret for that connection' };

  /* Constant time. A byte-by-byte early return would leak the secret
     to anyone willing to measure enough requests — and this endpoint
     invites unlimited attempts by design. */
  if (presented.length !== expected.length) {
    return { ok: false, why: `secret length ${presented.length} != ${expected.length}` };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, why: 'secret mismatch' };
}
