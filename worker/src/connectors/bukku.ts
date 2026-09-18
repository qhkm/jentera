/* ============================================================
   Bukku — Malaysian cloud accounting.

   Read operations only. Every call carries the owner's scoped token and
   their company subdomain, which Bukku requires as its own header and
   refuses (403) without.

   The token stays in the control plane. `runtime-credentials.ts` explains
   the rule: a credential handed to a sprite is one the agent can read, and
   therefore one an arbitrary web page pulled in by `web_extract` can ask it
   to repeat. A Bukku token opens quotations, invoices, payments and every
   customer record, so it never leaves the Worker.

   Paths, parameters and field names come from the published OpenAPI specs
   at developers.bukku.my/specs, checked against the live API on 2026-09-18.
   ============================================================ */

/** What a caller may pass in place of `fetch`. Deliberately wider than
    `typeof fetch`: a test double answers synchronously, and a signature
    that promises otherwise makes the double an error rather than a fake. */
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

const BUKKU_BASE = 'https://api.bukku.my';
/** Bukku pages its lists; nothing here needs more than one page of them. */
const MAX_PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 12_000;

export interface BukkuAccess {
  token: string;
  /** The company subdomain, kept as the connection's `externalId`. */
  subdomain: string;
}

/** Bukku's own vocabulary, not ours: the list filter is a query parameter
    rather than a field on the result. */
export type PaymentStatus = 'PAID' | 'OUTSTANDING' | 'OVERDUE';

export interface BukkuInvoice {
  id: number;
  number: string;
  contactName: string;
  contactEmail: string;
  date: string;
  amount: number;
  currency: string;
  status: string;
}

export interface BukkuContact {
  id: number;
  name: string;
  email: string;
  code: string;
}

interface InvoiceRow {
  id?: number; number?: string; contact_name?: string; contact_email?: string;
  date?: string; amount?: number; currency_code?: string; status?: string;
}
interface ContactRow {
  id?: number; display_name?: string; company_name?: string;
  email?: string; contact_code?: string;
}

export class BukkuError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BukkuError';
    this.status = status;
  }
}

/** One request. Never interpolates the token into a message: an error here
    is read by an owner and written to a log. */
async function request<T>(
  access: BukkuAccess,
  path: string,
  query: Record<string, string | number | undefined>,
  fetchImpl: Fetcher = fetch,
): Promise<T> {
  const url = new URL(path, BUKKU_BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${access.token}`,
        'Company-Subdomain': access.subdomain,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new BukkuError('Bukku did not respond', 0);
  }
  /* Bukku separates these, and so should the owner's message: one means
     reconnect, the other means the company is wrong or the token lost
     access to it. */
  if (response.status === 401) throw new BukkuError('Bukku rejected the saved token — reconnect Bukku', 401);
  if (response.status === 403) throw new BukkuError('That Bukku token no longer opens this company', 403);
  if (!response.ok) throw new BukkuError(`Bukku returned ${response.status}`, response.status);
  return await response.json() as T;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Invoices, optionally narrowed to what has or has not been paid.
 *
 * The list carries `amount` but no balance or due date — Bukku decides
 * outstanding and overdue itself, through the filter rather than a field,
 * so "who hasn't paid me" is this call with `OVERDUE` and not arithmetic
 * of ours over a list of everything.
 */
export async function listInvoices(
  access: BukkuAccess,
  options: { paymentStatus?: PaymentStatus; limit?: number; contactId?: number } = {},
  fetchImpl: Fetcher = fetch,
): Promise<BukkuInvoice[]> {
  const body = await request<{ transactions?: InvoiceRow[] }>(access, '/sales/invoices', {
    payment_status: options.paymentStatus,
    contact_id: options.contactId,
    /* `ready` excludes drafts and voided invoices: an unsent draft is not
       money anyone owes. */
    status: 'ready',
    page_size: Math.min(Math.max(1, options.limit ?? 20), MAX_PAGE_SIZE),
    page: 1,
  }, fetchImpl);
  return (body.transactions ?? []).map((row) => ({
    id: num(row.id),
    number: text(row.number),
    contactName: text(row.contact_name),
    contactEmail: text(row.contact_email),
    date: text(row.date),
    amount: num(row.amount),
    currency: text(row.currency_code) || 'MYR',
    status: text(row.status),
  }));
}

export async function listContacts(
  access: BukkuAccess,
  options: { search?: string; limit?: number } = {},
  fetchImpl: Fetcher = fetch,
): Promise<BukkuContact[]> {
  const body = await request<{ contacts?: ContactRow[] }>(access, '/contacts', {
    search: options.search,
    page_size: Math.min(Math.max(1, options.limit ?? 20), MAX_PAGE_SIZE),
    page: 1,
  }, fetchImpl);
  return (body.contacts ?? []).map((row) => ({
    id: num(row.id),
    name: text(row.display_name) || text(row.company_name),
    email: text(row.email),
    code: text(row.contact_code),
  }));
}
