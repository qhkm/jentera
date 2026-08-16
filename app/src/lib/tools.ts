/* ============================================================
   Agent tool contract (spec v1).

   One pattern for every connector. Risky operations do not execute
   — they queue for human approval. Execution is mocked; the point
   of the contract is that a real Workers executor can replace
   `execute` without any caller changing.
   ============================================================ */

import { CONNECTORS } from './data/connectors';
import { TOOL_RISK } from './data/risk';
import type { Approval, Connector, Risk } from './types';
import * as store from './storage';
import { KEYS } from './storage';
import { isConnected } from './business';
import { policyFor } from './permissions';

export function findConnector(nameOrKey: string): Connector | null {
  if (CONNECTORS[nameOrKey]) return CONNECTORS[nameOrKey];
  const hit = Object.values(CONNECTORS).find(
    (c) => c.n.toLowerCase() === nameOrKey.toLowerCase(),
  );
  return hit ?? null;
}

export function riskOf(op: string): Risk {
  return TOOL_RISK[op] ?? 'medium';
}

export interface ToolRequest {
  conn: string;
  op: string;
  args?: Record<string, unknown>;
  /** Defaults to true for anything above low risk. */
  dryRun?: boolean;
}

export type ToolResult =
  | { ok: false; err: string }
  | { ok: false; blocked: true; op: string; msg: string }
  | { ok: false; need: 'connect'; conn: string; msg: string }
  | { ok: true; dryRun: true; would: string; risk: Risk; queued: Approval }
  | { ok: true; mock: true; msg: string };

export function callTool(req: ToolRequest): ToolResult {
  const cx = findConnector(req.conn);
  if (!cx) return { ok: false, err: `unknown connector: ${req.conn}` };

  if (!isConnected(cx.n)) {
    return {
      ok: false,
      need: 'connect',
      conn: cx.n,
      msg: `Connect ${cx.n} first, in Connections.`,
    };
  }

  const risk = riskOf(req.op);
  const args = req.args ?? {};

  /* The owner's policy outranks the risk tier: a blocked operation
     never reaches the queue, and an automatic one skips it. */
  const policy = policyFor(req.op);
  if (policy === 'blocked') {
    return {
      ok: false,
      blocked: true,
      op: req.op,
      msg: `"${req.op}" is blocked in your permissions. Enable it in My Business to allow this.`,
    };
  }

  const dry = req.dryRun ?? policy === 'approval';

  if (dry) {
    return {
      ok: true,
      dryRun: true,
      would: `${cx.n} → ${req.op} ${JSON.stringify(args)}`,
      risk,
      queued: queueApproval(cx.n, req.op, args, risk),
    };
  }

  // Replace this branch with the real executor; the contract is unchanged.
  return { ok: true, mock: true, msg: `${cx.n} → ${req.op} OK (mock — no backend executor yet).` };
}

/* ---- Approval queue: the human stays in the loop for outbound actions ---- */

export function queueApproval(
  conn: string,
  op: string,
  args: Record<string, unknown>,
  risk: Risk,
): Approval {
  const q = listApprovals();
  const entry: Approval = {
    id: Date.now(),
    conn,
    op,
    args,
    risk,
    ts: new Date().toISOString(),
    status: 'pending',
  };
  q.push(entry);
  store.setJSON(KEYS.approvals, q);
  return entry;
}

export function listApprovals(): Approval[] {
  return store.getJSON<Approval[]>(KEYS.approvals, []);
}

export function pendingApprovals(): Approval[] {
  return listApprovals().filter((a) => a.status === 'pending');
}

export function decideApproval(id: number, approved: boolean): Approval[] {
  const q = listApprovals().map((a) =>
    a.id === id
      ? { ...a, status: approved ? ('approved' as const) : ('rejected' as const), decided: new Date().toISOString() }
      : a,
  );
  store.setJSON(KEYS.approvals, q);
  return q;
}
