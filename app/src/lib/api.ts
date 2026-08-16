/* ============================================================
   Remote executor client.

   The app works with no backend at all — approvals live in
   localStorage and tool calls are mocked. Set VITE_API_URL and the
   same operations route to the Worker instead, which persists to D1
   and owns execution.

   `isRemote()` is the only branch; everything downstream is the same
   shape either way, which is the point of the tool contract.
   ============================================================ */

import type { Approval, Risk } from './types';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export function isRemote(): boolean {
  return BASE.length > 0;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.err ?? `${res.status} ${res.statusText}`));
  }
  return body as T;
}

/** Server-side approval, mapped onto the client's Approval shape. */
interface RemoteApproval {
  id: string;
  connector: string;
  op: string;
  args: Record<string, unknown>;
  risk: Risk;
  status: string;
  createdAt: string;
  decidedAt: string | null;
}

function toClient(a: RemoteApproval): Approval {
  return {
    // The client keys on number; hash the uuid so existing UI code is unchanged.
    id: hashId(a.id),
    conn: a.connector,
    op: a.op,
    args: a.args,
    risk: a.risk,
    ts: a.createdAt,
    status: a.status === 'pending' ? 'pending' : a.status === 'rejected' ? 'rejected' : 'approved',
    decided: a.decidedAt ?? undefined,
    remoteId: a.id,
  };
}

/** Stable 32-bit hash so a uuid can key the existing numeric-id UI. */
function hashId(uuid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function callToolRemote(input: {
  business: string;
  conn: string;
  op: string;
  args?: Record<string, unknown>;
  dryRun?: boolean;
}) {
  return req<{ ok: true; dryRun?: boolean; risk?: Risk; detail?: string }>('/api/tools/call', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listApprovalsRemote(business: string): Promise<Approval[]> {
  const body = await req<{ approvals: RemoteApproval[] }>(
    `/api/approvals?business=${encodeURIComponent(business)}&status=pending`,
  );
  return body.approvals.map(toClient);
}

export async function decideApprovalRemote(remoteId: string, approved: boolean) {
  return req<{ status: string; detail?: string }>(
    `/api/approvals/${encodeURIComponent(remoteId)}/decide`,
    { method: 'POST', body: JSON.stringify({ approved }) },
  );
}

export async function health(): Promise<boolean> {
  if (!isRemote()) return false;
  try {
    await req('/api/health');
    return true;
  } catch {
    return false;
  }
}
