import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from '../src/connectors';
import { listInvoices, listContacts, BukkuError } from '../src/connectors/bukku';
import { saveConnection } from '../src/connections';
import { asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const OWNER = '33333333-3333-4333-8333-333333333333';
const TOKEN = ['b'.repeat(20), 'c'.repeat(40), 'd'.repeat(43)].join('.');

/* Field names and the payment_status vocabulary come from the published
   OpenAPI specs and were checked against the live API on 2026-09-18: the
   list carries `amount` and `status` but no balance or due date, and an
   invalid filter value answers 422 rather than being ignored. */
const INVOICE_ROW = {
  id: 1, number: 'IV-00231', contact_name: 'Alex Wong', contact_email: 'alex@example.com',
  date: '2026-09-01', amount: 2000, currency_code: 'MYR', status: 'ready',
};

async function connectBukku() {
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Kedai', 'restaurant')`;
    await sql`insert into app_user (id, email, email_verified) values (${OWNER}, 'o@test', true)`;
    await sql`insert into membership (business_id, user_id, role) values (${A}, ${OWNER}, 'owner')`;
  });
  await asTenant(A, (tx) => saveConnection(testEnv(), tx, A, {
    connector: 'Bukku', method: 'api_token', externalId: 'aisar',
    displayName: 'Aisar AI', secret: TOKEN, connectedBy: OWNER,
  }));
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await truncateAll();
  await connectBukku();
});
afterEach(() => vi.unstubAllGlobals());

describe('reading Bukku', () => {
  it('sends the company as a header, not only in the URL', async () => {
    const upstream = fetchFake(async () => Response.json({ transactions: [INVOICE_ROW] }));
    const rows = await listInvoices({ token: TOKEN, subdomain: 'aisar' }, { paymentStatus: 'OVERDUE' }, upstream);
    const [url, init] = upstream.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Company-Subdomain']).toBe('aisar');
    /* Bukku decides overdue itself, through the filter, so this must reach
       the query — computing it here from a list of everything would be a
       different and wronger answer. */
    expect(new URL(String(url)).searchParams.get('payment_status')).toBe('OVERDUE');
    /* Drafts and voided invoices are not money anyone owes. */
    expect(new URL(String(url)).searchParams.get('status')).toBe('ready');
    expect(rows[0]).toMatchObject({ number: 'IV-00231', contactName: 'Alex Wong', amount: 2000 });
  });

  it('caps the page size however large a caller asks', async () => {
    const upstream = fetchFake(async () => Response.json({ contacts: [] }));
    await listContacts({ token: TOKEN, subdomain: 'aisar' }, { limit: 5_000 }, upstream);
    expect(Number(new URL(String(upstream.mock.calls[0][0])).searchParams.get('page_size')))
      .toBeLessThanOrEqual(50);
  });

  it('turns Bukku’s two refusals into two different things to do', async () => {
    for (const [status, expected] of [[401, /reconnect/i], [403, /no longer opens/i]] as const) {
      await expect(listInvoices({ token: TOKEN, subdomain: 'aisar' }, {},
        fetchFake(async () => new Response('{}', { status }))))
        .rejects.toThrow(expected);
    }
  });

  it('never puts the token in an error an owner or a log will see', async () => {
    const failed = await listInvoices({ token: TOKEN, subdomain: 'aisar' }, {},
      fetchFake(async () => new Response('{}', { status: 500 }))).catch((e: BukkuError) => e);
    expect(String((failed as BukkuError).message)).not.toContain(TOKEN);
  });
});

describe('the Bukku executor', () => {
  it('reads the connected company, and says so in words an owner can use', async () => {
    vi.stubGlobal('fetch', fetchFake(async () => Response.json({ transactions: [INVOICE_ROW] })));
    const result = await execute({
      env: testEnv(), business: A, connector: 'Bukku', op: 'list',
      args: { resource: 'invoices', paymentStatus: 'overdue' },
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('IV-00231');
    expect(result.detail).toContain('Alex Wong');
  });

  it('refuses a write, because a write belongs behind the approval gate', async () => {
    const result = await execute({
      env: testEnv(), business: A, connector: 'Bukku', op: 'send', args: {},
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/reading only/i);
  });

  it('refuses a payment status Bukku does not have, rather than sending it', async () => {
    const upstream = fetchFake(async () => Response.json({ transactions: [] }));
    vi.stubGlobal('fetch', upstream);
    const result = await execute({
      env: testEnv(), business: A, connector: 'Bukku', op: 'list',
      args: { resource: 'invoices', paymentStatus: 'nearly-paid' },
    });
    expect(result.ok).toBe(false);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('says Bukku is not connected rather than failing obscurely', async () => {
    await asOwner((sql) => sql`delete from connection where business_id = ${A}`);
    const result = await execute({
      env: testEnv(), business: A, connector: 'Bukku', op: 'list', args: {},
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.detail).toMatch(/not connected/i);
  });
});
