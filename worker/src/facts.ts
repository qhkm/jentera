/* ============================================================
   Reading and correcting business facts.

   Every function here takes a connection rather than an Env, so the
   test suite runs these exact statements instead of copies. The
   correction sequence below is the kind of thing that looks obviously
   right and is quietly wrong when the ordering slips.
   ============================================================ */

import type postgres from 'postgres';

export type FactSource = 'owner' | 'import' | 'agent' | 'connector';

export const SOURCES: readonly FactSource[] = ['owner', 'import', 'agent', 'connector'];

export interface Fact {
  key: string;
  value: unknown;
  source: FactSource;
  sourceRef: string | null;
  confidence: number;
  confirmed: boolean;
  confirmedAt: Date | null;
  version: number;
  createdAt: Date;
}

interface Row {
  key: string;
  value: unknown;
  source: FactSource;
  source_ref: string | null;
  confidence: number;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  version: number;
  created_at: Date;
}

const toFact = (r: Row): Fact => ({
  key: r.key,
  value: r.value,
  source: r.source,
  sourceRef: r.source_ref,
  confidence: r.confidence,
  confirmed: r.confirmed_by !== null,
  confirmedAt: r.confirmed_at,
  version: r.version,
  createdAt: r.created_at,
});

/** Everything currently believed about this business. */
export async function liveFacts(tx: postgres.TransactionSql): Promise<Fact[]> {
  const rows = await tx<Row[]>`
    select key, value, source, source_ref, confidence,
           confirmed_by, confirmed_at, version, created_at
      from business_fact
     where live
     order by key`;
  return rows.map(toFact);
}

/**
 * Record a fact, superseding whatever was believed before.
 *
 * The order is load-bearing. Retiring the old row BEFORE inserting the
 * new one is what keeps the partial unique index satisfiable: for the
 * instant between the two statements there is no live row for the key,
 * which the index permits, whereas two live rows it does not. Doing it
 * the other way round fails outright.
 *
 * All three statements run inside the caller's transaction, so a
 * failure partway through cannot leave the key with no live value at
 * all.
 */
export async function recordFact(
  tx: postgres.TransactionSql,
  businessId: string,
  input: {
    key: string;
    value: unknown;
    source: FactSource;
    sourceRef?: string | null;
    confidence?: number;
    /** Set when the owner is stating the fact themselves — authorship
        and confirmation coincide only in that case. */
    confirmedBy?: string | null;
  },
): Promise<Fact> {
  await tx`
    update business_fact
       set live = false, superseded_at = now()
     where business_id = ${businessId} and key = ${input.key} and live`;

  /* Counted over the whole history, not over the row just retired.
     A key that was forgotten has no live row, so deriving the version
     from one restarts at 1 and collides with the 1 already in history
     — two rows claiming the same version, and `order by version desc`
     ties between them. Found by the test for exactly that sequence:
     record, forget, record. */
  const [{ next }] = await tx<{ next: number }[]>`
    select coalesce(max(version), 0) + 1 as next
      from business_fact
     where business_id = ${businessId} and key = ${input.key}`;
  const nextVersion = next;
  const confirmedBy = input.confirmedBy ?? null;

  const [row] = await tx<Row[]>`
    insert into business_fact
      (business_id, key, value, source, source_ref, confidence,
       confirmed_by, confirmed_at, version)
    values
      (${businessId}, ${input.key}, ${tx.json(input.value as never)}, ${input.source},
       ${input.sourceRef ?? null}, ${input.confidence ?? 1.0},
       ${confirmedBy}, ${confirmedBy ? tx`now()` : null}, ${nextVersion})
    returning key, value, source, source_ref, confidence,
              confirmed_by, confirmed_at, version, created_at`;

  return toFact(row);
}

/**
 * Vouch for the live version of a fact.
 *
 * Deliberately does not touch `confidence`. Confidence describes how
 * the value was arrived at; confirmation describes who is willing to
 * stand behind it. Collapsing them would erase the difference between
 * "the model was sure" and "a human checked".
 */
export async function confirmFact(
  tx: postgres.TransactionSql,
  businessId: string,
  key: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx`
    update business_fact
       set confirmed_by = ${userId}, confirmed_at = now()
     where business_id = ${businessId} and key = ${key} and live
    returning id`;
  return rows.length > 0;
}

/**
 * Retire a fact without replacing it.
 *
 * Leaves the retired rows in place: "we used to believe X and the
 * owner deleted it" is itself worth knowing when a later run proposes
 * X again.
 */
export async function forgetFact(
  tx: postgres.TransactionSql,
  businessId: string,
  key: string,
): Promise<boolean> {
  const rows = await tx`
    update business_fact
       set live = false, superseded_at = now()
     where business_id = ${businessId} and key = ${key} and live
    returning id`;
  return rows.length > 0;
}

/** Every version of one key, newest first. */
export async function factHistory(
  tx: postgres.TransactionSql,
  businessId: string,
  key: string,
): Promise<Fact[]> {
  const rows = await tx<Row[]>`
    select key, value, source, source_ref, confidence,
           confirmed_by, confirmed_at, version, created_at
      from business_fact
     where business_id = ${businessId} and key = ${key}
     order by version desc`;
  return rows.map(toFact);
}

/** Reject a key that would break retrieval later. */
export function keyProblem(key: unknown): string | null {
  if (typeof key !== 'string' || key.trim() === '') return 'key is required';
  if (key.length > 120) return 'key is too long';
  // Dotted lowercase path. Keeps keys greppable and stops a caller
  // inventing 'Hours.Monday' alongside an existing 'hours.monday'.
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(key)) {
    return 'key must be a dotted lowercase path, e.g. hours.monday';
  }
  return null;
}
