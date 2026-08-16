/* ============================================================
   D1 persistence for approvals and the audit log.
   ============================================================ */

export type Risk = 'low' | 'medium' | 'high';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface ApprovalRow {
  id: string;
  business: string;
  connector: string;
  op: string;
  args: string;
  risk: Risk;
  status: ApprovalStatus;
  created_at: string;
  decided_at: string | null;
  result: string | null;
}

export interface Approval {
  id: string;
  business: string;
  connector: string;
  op: string;
  args: Record<string, unknown>;
  risk: Risk;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
  result: unknown;
}

function hydrate(row: ApprovalRow): Approval {
  const parse = (s: string | null) => {
    if (s === null) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  return {
    id: row.id,
    business: row.business,
    connector: row.connector,
    op: row.op,
    args: parse(row.args) ?? {},
    risk: row.risk,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    result: parse(row.result),
  };
}

export async function queueApproval(
  db: D1Database,
  entry: Omit<Approval, 'status' | 'createdAt' | 'decidedAt' | 'result'>,
): Promise<Approval> {
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO approvals (id, business, connector, op, args, risk, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      entry.id,
      entry.business,
      entry.connector,
      entry.op,
      JSON.stringify(entry.args),
      entry.risk,
      createdAt,
    )
    .run();

  return { ...entry, status: 'pending', createdAt, decidedAt: null, result: null };
}

export async function listApprovals(
  db: D1Database,
  business: string,
  status?: ApprovalStatus,
): Promise<Approval[]> {
  const stmt = status
    ? db
        .prepare(
          `SELECT * FROM approvals WHERE business = ? AND status = ? ORDER BY created_at DESC LIMIT 200`,
        )
        .bind(business, status)
    : db
        .prepare(`SELECT * FROM approvals WHERE business = ? ORDER BY created_at DESC LIMIT 200`)
        .bind(business);

  const { results } = await stmt.all<ApprovalRow>();
  return (results ?? []).map(hydrate);
}

export async function getApproval(db: D1Database, id: string): Promise<Approval | null> {
  const row = await db.prepare(`SELECT * FROM approvals WHERE id = ?`).bind(id).first<ApprovalRow>();
  return row ? hydrate(row) : null;
}

/**
 * Only a pending approval can be decided. The WHERE clause carries that
 * rule so two concurrent approvals cannot both execute — the second
 * one's update matches no rows.
 */
export async function decideApproval(
  db: D1Database,
  id: string,
  status: Extract<ApprovalStatus, 'approved' | 'rejected'>,
): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(status, new Date().toISOString(), id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function recordResult(
  db: D1Database,
  id: string,
  status: Extract<ApprovalStatus, 'executed' | 'failed'>,
  result: unknown,
): Promise<void> {
  await db
    .prepare(`UPDATE approvals SET status = ?, result = ? WHERE id = ?`)
    .bind(status, JSON.stringify(result), id)
    .run();
}

export async function log(
  db: D1Database,
  entry: {
    id: string;
    business: string;
    connector: string;
    op: string;
    outcome: 'queued' | 'executed' | 'refused' | 'error';
    detail?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tool_log (id, business, connector, op, outcome, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.business,
      entry.connector,
      entry.op,
      entry.outcome,
      entry.detail ?? null,
      new Date().toISOString(),
    )
    .run();
}
