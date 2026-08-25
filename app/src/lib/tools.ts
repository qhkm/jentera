import { CONNECTORS } from './data/connectors';
import { TOOL_RISK } from './data/risk';
import type { Approval, Connector, Risk } from './types';
import { isConnected } from './business';
import { policyFor } from './permissions';
import type { BusinessSnapshot } from '@/lib/repo/types';

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

export function callTool(snap: BusinessSnapshot, req: ToolRequest): ToolResult {
  const cx = findConnector(req.conn);
  if (!cx) return { ok: false, err: `unknown connector: ${req.conn}` };

  if (!isConnected(snap, cx.n)) {
    return { ok: false, need: 'connect', conn: cx.n, msg: `Connect ${cx.n} first, in Connections.` };
  }

  const risk = riskOf(req.op);
  const args = req.args ?? {};
  const policy = policyFor(snap, req.op);

  if (policy === 'blocked') {
    return {
      ok: false, blocked: true, op: req.op,
      msg: `"${req.op}" is blocked in your permissions. Enable it in My Business to allow this.`,
    };
  }

  if (req.dryRun ?? policy === 'approval') {
    return {
      ok: true, dryRun: true,
      would: `${cx.n} → ${req.op} ${JSON.stringify(args)}`,
      risk,
      queued: {
        id: Date.now(),
        conn: cx.n,
        op: req.op,
        args,
        risk,
        ts: new Date().toISOString(),
        status: 'pending',
      },
    };
  }

  return { ok: true, mock: true, msg: `${cx.n} → ${req.op} OK (mock — no backend executor yet).` };
}

export function listApprovals(snap: BusinessSnapshot): Approval[] {
  return snap.approvals;
}

export function pendingApprovals(snap: BusinessSnapshot): Approval[] {
  return snap.approvals.filter((a) => a.status === 'pending');
}
