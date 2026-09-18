import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleConnect } from '../src/routes/connect';
import { TOKEN_CONNECTORS } from '../src/token-connectors';
import { asOwner, fetchFake, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const OWNER = '33333333-3333-4333-8333-333333333333';
const STAFF = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'a'.repeat(40);
/* Bukku issues a JWT; only its shape matters to these tests. */
const BUKKU_TOKEN = ['b'.repeat(20), 'c'.repeat(40), 'd'.repeat(43)].join('.');

/* Shapes confirmed against the live API on 2026-09-18: /companies answers
   { companies: [{ id, legal_name, subdomain }] }, a bad token 401, and a
   company the token cannot open 403. */
function bukkuOk(subdomain = 'aisar', legalName = 'Aisar Sdn Bhd') {
  return fetchFake(async () => Response.json({
    companies: [{ id: 130515, legal_name: legalName, subdomain }],
  }));
}

async function seed() {
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Kedai', 'restaurant')`;
    /* Staff seats count only on the team plan (migration 038). */
    await sql`update business set plan = 'team' where id = ${A}`;
    for (const [id, role] of [[OWNER, 'owner'], [STAFF, 'staff']] as const) {
      await sql`insert into app_user (id, email, email_verified)
                values (${id}, ${`${id}@test`}, true)`;
      await sql`insert into membership (business_id, user_id, role)
                values (${A}, ${id}, ${role})`;
    }
  });
}

function cloudflareOk() {
  return fetchFake(async () => Response.json({
    success: true,
    result: { id: 'token-id-1', status: 'active' },
  }));
}

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };

/* Typed as what fetchFake returns, not as `typeof fetch`: the fake may
   answer synchronously, and the global's signature promises it never
   will. The suite typechecks, so that mismatch is an error rather than
   something that happens to run. */
async function post(cookie: string, body: unknown, upstream?: ReturnType<typeof fetchFake>) {
  if (upstream) vi.stubGlobal('fetch', upstream);
  const { request, url } = req('POST', '/api/connections/token', { cookie, body });
  return handleConnect(request, testEnv(), url, CORS);
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await truncateAll();
  await seed();
});

describe('connecting Bukku, which needs a company as well as a token', () => {
  it('sends both headers and keeps the company as the connection identity', async () => {
    const cookie = await signIn(OWNER);
    const upstream = bukkuOk();
    const response = await post(cookie,
      { connector: 'Bukku', token: BUKKU_TOKEN, account: 'aisar' }, upstream);
    expect(response?.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe('https://api.bukku.my/companies');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${BUKKU_TOKEN}`);
    /* Bukku refuses without this, so a missing header is a connector that
       never works rather than one that works for some owners. */
    expect(headers['Company-Subdomain']).toBe('aisar');

    /* The subdomain is not a secret and every later request needs it, so it
       is the row's identity — execution reads it without touching the vault. */
    const [row] = await asOwner((sql) => sql<{ external_id: string; display_name: string }[]>`
      select external_id, display_name from connection where business_id = ${A}`);
    expect(row).toMatchObject({ external_id: 'aisar', display_name: 'Aisar Sdn Bhd' });
  });

  it('refuses a token that opens a different company than the one typed', async () => {
    const cookie = await signIn(OWNER);
    /* A valid token for someone else's books would otherwise connect
       silently and fail later against the wrong accounts. */
    const response = await post(cookie,
      { connector: 'Bukku', token: BUKKU_TOKEN, account: 'aisar' }, bukkuOk('someone-else'));
    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({ ok: false });
    expect(await asOwner((sql) => sql`select 1 from connection where business_id = ${A}`))
      .toHaveLength(0);
  });

  it('tells the owner which half was wrong', async () => {
    const cookie = await signIn(OWNER);
    for (const [status, expected] of [[401, /rejected that token/], [403, /does not open/]] as const) {
      const response = await post(cookie, { connector: 'Bukku', token: BUKKU_TOKEN, account: 'aisar' },
        fetchFake(async () => new Response('{}', { status })));
      expect(response?.status).toBe(400);
      expect((await response!.json() as { err: string }).err).toMatch(expected);
    }
  });

  it('rejects a missing or malformed company before any request goes out', async () => {
    const cookie = await signIn(OWNER);
    for (const account of [undefined, '', 'not a subdomain', '-leading-dash']) {
      const upstream = bukkuOk();
      const response = await post(cookie, { connector: 'Bukku', token: BUKKU_TOKEN, account }, upstream);
      expect(response?.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
    }
  });

  it('offers the extra field to the page that has to render it', async () => {
    const cookie = await signIn(OWNER);
    const { request, url } = req('GET', '/api/connections/token', { cookie });
    const body = await (await handleConnect(request, testEnv(), url, CORS))!.json() as {
      connectors: { connector: string; account?: { label: string; hint: string } }[];
    };
    const bukku = body.connectors.find((entry) => entry.connector === 'Bukku');
    expect(bukku?.account?.label).toBe('Company subdomain');
    expect(bukku?.account?.hint).toContain('aisar');
    /* And a connector that needs no second field still says nothing. */
    expect(body.connectors.find((entry) => entry.connector === 'Cloudflare')?.account).toBeUndefined();
  });
});

describe('connecting a service with a scoped token', () => {
  it('verifies with the provider, then stores it sealed', async () => {
    const cookie = await signIn(OWNER);
    const upstream = cloudflareOk();
    const response = await post(cookie, { connector: 'Cloudflare', token: TOKEN }, upstream);
    expect(response?.status).toBe(200);

    /* Proven before stored: a credential nobody has used is a connection
       the owner believes in and a failure they meet later. */
    expect(upstream).toHaveBeenCalledOnce();
    expect(String(upstream.mock.calls[0][0]))
      .toBe('https://api.cloudflare.com/client/v4/user/tokens/verify');

    const [row] = await asOwner((sql) => sql<{ connector: string; method: string }[]>`
      select connector, method from connection where business_id = ${A}`);
    expect(row).toMatchObject({ connector: 'Cloudflare', method: 'api_token' });

    /* The token is sealed, so it must not be findable in the clear. */
    const [cred] = await asOwner((sql) => sql<{ ciphertext: Uint8Array }[]>`
      select ciphertext from credential`);
    expect(new TextDecoder().decode(cred.ciphertext)).not.toContain(TOKEN);
  });

  it('stores nothing when the provider rejects the token', async () => {
    const cookie = await signIn(OWNER);
    const upstream = fetchFake(async () => Response.json(
      { success: false, errors: [{ message: 'Invalid API Token' }] },
      { status: 401 },
    ));
    const response = await post(cookie, { connector: 'Cloudflare', token: TOKEN }, upstream);
    expect(response?.status).toBe(400);
    expect(await asOwner((sql) => sql`select id from connection`)).toHaveLength(0);
  });

  it('refuses a token that is not active', async () => {
    const cookie = await signIn(OWNER);
    const upstream = fetchFake(async () => Response.json({
      success: true, result: { id: 'token-id-1', status: 'disabled' },
    }));
    const response = await post(cookie, { connector: 'Cloudflare', token: TOKEN }, upstream);
    expect(response?.status).toBe(400);
    expect(await asOwner((sql) => sql`select id from connection`)).toHaveLength(0);
  });

  it('rejects an obvious paste error without calling the provider at all', async () => {
    const cookie = await signIn(OWNER);
    const upstream = cloudflareOk();
    const response = await post(cookie, { connector: 'Cloudflare', token: 'nope' }, upstream);
    expect(response?.status).toBe(400);
    /* The value never reaches an outbound request, so a mistyped password
       cannot be recorded by anything in between. */
    expect(upstream).not.toHaveBeenCalled();
  });

  it('is the owner\'s to give: staff may not connect one', async () => {
    const cookie = await signIn(STAFF);
    const upstream = cloudflareOk();
    const response = await post(cookie, { connector: 'Cloudflare', token: TOKEN }, upstream);
    expect(response?.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a connector it does not know', async () => {
    const cookie = await signIn(OWNER);
    const upstream = cloudflareOk();
    const response = await post(cookie, { connector: 'Whatever', token: TOKEN }, upstream);
    expect(response?.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('lists what can be connected without naming anything secret', async () => {
    const cookie = await signIn(OWNER);
    const { request, url } = req('GET', '/api/connections/token', { cookie });
    const response = await handleConnect(request, testEnv(), url, CORS);
    expect(response?.status).toBe(200);
    const body = await response!.json() as { connectors: { connector: string }[] };
    expect(body.connectors.map((c) => c.connector))
      .toEqual(Object.keys(TOKEN_CONNECTORS));
  });
});
