/* ============================================================
   Connector execution — the one place real outbound calls go.

   THIS IS THE BOUNDARY. Everything else in this Worker (risk
   gating, the approval queue, the audit log, the HTTP contract)
   is real and working. The functions below are stubs, because
   executing against WhatsApp / Google / Shopee needs OAuth app
   registrations and per-tenant tokens that have to be created in
   each provider's console first.

   To go live for one connector: register the app, store the
   secret with `wrangler secret put`, and replace that connector's
   `execute` body. Nothing upstream changes — the caller, the risk
   gate and the approval flow already work.
   ============================================================ */

import type { Env } from './env';

export interface ExecContext {
  env: Env;
  business: string;
  connector: string;
  op: string;
  args: Record<string, unknown>;
}

export interface ExecResult {
  ok: boolean;
  detail: string;
  /** Provider-side identifier, when the call produced one. */
  ref?: string;
}

type Executor = (ctx: ExecContext) => Promise<ExecResult>;

/** Every connector that a playbook can reference. */
const NOT_WIRED = (name: string): Executor => async ({ op }) => ({
  ok: false,
  detail:
    `${name} is not wired to a live provider yet — ${op} was authorised but not sent. ` +
    `Register the app, add its secret, and implement this connector's execute().`,
});

export const EXECUTORS: Record<string, Executor> = {
  WhatsApp: NOT_WIRED('WhatsApp'),
  Instagram: NOT_WIRED('Instagram'),
  'Google Calendar': NOT_WIRED('Google Calendar'),
  'Google Sheets': NOT_WIRED('Google Sheets'),
  'Store platform': NOT_WIRED('Store platform'),
  'Payment gateway': NOT_WIRED('Payment gateway'),
  'Accounting / POS': NOT_WIRED('Accounting / POS'),
  Shopee: NOT_WIRED('Shopee'),
  Lazada: NOT_WIRED('Lazada'),
  'TikTok Shop': NOT_WIRED('TikTok Shop'),
};

export async function execute(ctx: ExecContext): Promise<ExecResult> {
  const run = EXECUTORS[ctx.connector];
  if (!run) {
    return { ok: false, detail: `Unknown connector: ${ctx.connector}` };
  }
  try {
    return await run(ctx);
  } catch (err) {
    return { ok: false, detail: `Execution failed: ${(err as Error).message}` };
  }
}
