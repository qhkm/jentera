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
import { withTenant } from './db';
import { useCredential } from './connections';
import { listContacts, listInvoices, BukkuError, type PaymentStatus } from './connectors/bukku';

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

/** Bukku's own filter vocabulary; anything else is the caller's mistake. */
const PAYMENT_STATUSES: readonly PaymentStatus[] = ['PAID', 'OUTSTANDING', 'OVERDUE'];

/**
 * Read from the owner's Bukku.
 *
 * The token and the company are loaded per call inside the tenant
 * transaction and never held anywhere else; the subdomain is the
 * connection's `external_id`, so only the token comes out of the vault.
 *
 * Reads only. Creating a quotation or an invoice is a write against an
 * owner's books and belongs behind the approval gate, not behind a `list`
 * that `risk.ts` scores as low.
 */
const bukku: Executor = async ({ env, business, op, args }) => {
  if (op !== 'list' && op !== 'read') {
    return { ok: false, detail: `Bukku supports reading only — ${op} was not sent.` };
  }
  const access = await withTenant(env, business, async (tx) => {
    const [row] = await tx<{ id: string; external_id: string | null }[]>`
      select id, external_id from connection
       where business_id = ${business} and connector = 'Bukku' and status = 'connected'
       order by connected_at desc limit 1`;
    if (!row?.external_id) return null;
    return { token: await useCredential(env, tx, row.id), subdomain: row.external_id };
  });
  if (!access) return { ok: false, detail: 'Bukku is not connected for this business.' };

  const resource = typeof args.resource === 'string' ? args.resource : 'invoices';
  const limit = typeof args.limit === 'number' ? args.limit : undefined;
  try {
    if (resource === 'contacts') {
      const contacts = await listContacts(access, {
        search: typeof args.search === 'string' ? args.search : undefined, limit,
      });
      return {
        ok: true,
        detail: contacts.length
          ? contacts.map((c) => `${c.name}${c.email ? ` <${c.email}>` : ''}`).join('; ')
          : 'No matching contacts in Bukku.',
      };
    }
    if (resource !== 'invoices') {
      return { ok: false, detail: `Bukku has nothing called “${resource}” to read.` };
    }
    const requested = typeof args.paymentStatus === 'string'
      ? args.paymentStatus.toUpperCase() as PaymentStatus : undefined;
    if (requested && !PAYMENT_STATUSES.includes(requested)) {
      return { ok: false, detail: `Payment status must be one of ${PAYMENT_STATUSES.join(', ')}.` };
    }
    const invoices = await listInvoices(access, { paymentStatus: requested, limit });
    if (!invoices.length) {
      return { ok: true, detail: requested === 'OVERDUE'
        ? 'Nothing is overdue in Bukku.' : 'No matching invoices in Bukku.' };
    }
    return {
      ok: true,
      detail: invoices
        .map((i) => `${i.number} · ${i.contactName} · ${i.currency} ${i.amount.toFixed(2)} · ${i.date}`)
        .join('; '),
      ref: invoices[0].number || undefined,
    };
  } catch (error) {
    /* A BukkuError already says which half is wrong in the owner's terms;
       anything else stays generic so a provider body cannot reach a screen. */
    if (error instanceof BukkuError) return { ok: false, detail: error.message };
    return { ok: false, detail: 'Bukku could not be read.' };
  }
};

export const EXECUTORS: Record<string, Executor> = {
  Bukku: bukku,
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
