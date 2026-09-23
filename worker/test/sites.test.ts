import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sites, { handleSites } from '../src/sites/index';
import type { SitesEnv } from '../src/sites/env';
import { SECURITY_HEADERS } from '../src/sites/render';
import { SITEVERIFY } from '../src/turnstile';
import { asOwner, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-05T00:00:00Z'); // Mon 08:00 Malaysia
const TEN = '2026-10-06T02:00:00.000Z';       // Tue 10:00 Malaysia
let service = '';
let burstOk = true;
let sitesBurstOk = true;
let brakeKeys: string[] = [];
/** A database that refuses every connection: reaching it throws. */
const NOWHERE = { connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none' } as SitesEnv['HYPERDRIVE'];

const brake = (ok: () => boolean) => ({
  limit: async ({ key }: { key: string }) => {
    brakeKeys.push(key);
    return { success: ok() };
  },
}) as unknown as RateLimit;

const env = (over: Partial<SitesEnv> = {}): SitesEnv => ({
  HYPERDRIVE: testEnv().HYPERDRIVE,
  APPS_ENABLED: 'true',
  APPS_BUSINESS_IDS: A,
  SITES_ORIGIN: 'https://sites.test',
  TURNSTILE_SITE_KEY: 'site-key',
  BOOKING_BURST: brake(() => burstOk),
  SITES_BURST: brake(() => sitesBurstOk),
  ...over,
});

beforeEach(async () => {
  burstOk = true;
  sitesBurstOk = true;
  brakeKeys = [];
  await truncateAll();
  service = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang) values (${A}, 'SEIDO <Coffee>', 'services', true, 'en')`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('o@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${u.id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    await sql`insert into app_slug (public_slug, business_id, app_key) values ('seido', ${A}, 'bookings'), ('seido-lama', ${A}, 'bookings')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days)
      values (${A}, now(), 120, 30)`;
    const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Cupping class', 60, 2) returning id`;
    await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes) values (${A}, ${s.id}, 2, '10:00', '13:00')`;
    return s.id;
  });
});

function get(path: string, e = env()) {
  return handleSites(new Request(`https://sites.test${path}`), e, { now: () => NOW });
}

function post(fields: Record<string, string>, e = env(), fetchImpl?: typeof fetch, path = '/b/seido/request?lang=en') {
  const body = new URLSearchParams(fields);
  const request = new Request(`https://sites.test${path}`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.9' },
  });
  return handleSites(request, e, { now: () => NOW, fetchImpl });
}

/** A POST whose body and type the test chooses. */
function rawPost(body: string, contentType: string, headers: Record<string, string> = {}) {
  return new Request('https://sites.test/b/seido/request?lang=en', {
    method: 'POST', body, headers: { 'Content-Type': contentType, 'CF-Connecting-IP': '203.0.113.9', ...headers },
  });
}

/** Through the deployed entry, so a throw would show as its 500 and its log. */
function sendRaw(body: string, contentType: string, headers: Record<string, string> = {}) {
  return sites.fetch(rawPost(body, contentType, headers), env());
}

function expectSecurityHeaders(res: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
  expect(res.headers.get('Set-Cookie')).toBeNull();
}

const form = (over: Record<string, string> = {}) => ({
  service, start: TEN, party: '1', name: 'Aisyah', phone: '012-345 6789', note: '',
  submission_key: '33333333-3333-4333-8333-333333333333', ...over,
});

describe('sites: pages', () => {
  it('lists services with escaped names, the security headers and no cookie', async () => {
    const res = await get('/b/seido');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SEIDO &lt;Coffee&gt;');
    expect(html).toContain('Cupping class');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('answers 404 outside /b/, for unknown names, and for a business off the pilot list', async () => {
    expect((await get('/api/me')).status).toBe(404);
    expect((await get('/')).status).toBe(404);
    expect((await get('/b/nobody')).status).toBe(404);
    const off = env({ APPS_BUSINESS_IDS: '22222222-2222-4222-8222-222222222222' });
    expect((await get('/b/seido', off)).status).toBe(404);
    expect((await get('/b/seido/done?ref=K7Q2MP', off)).status).toBe(404);
  });

  it('sends a name used before to the current page', async () => {
    const res = await get('/b/seido-lama?service=x&lang=bm');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/b/seido?service=x&lang=bm');
  });

  it('shows open times and keeps the language through the steps', async () => {
    const html = await (await get(`/b/seido?service=${service}&date=2026-10-06&lang=bm`)).text();
    expect(html).toContain('<html lang="ms">');
    expect(html).toContain('10.00 pagi');
    expect(html).toContain('lang=bm');
  });

  it('shows the form with the privacy notice, the widget and a submission key', async () => {
    const html = await (await get(`/b/seido/request?service=${service}&start=${encodeURIComponent(TEN)}`)).text();
    expect(html).toContain('Your name and phone number go to SEIDO &lt;Coffee&gt;');
    expect(html).toContain('data-action="booking"');
    expect(html).toMatch(/name="submission_key" value="[0-9a-f-]{36}"/);
  });

  it('sends a customer back to the times when the start is no longer offered', async () => {
    const res = await get(`/b/seido/request?service=${service}&start=${encodeURIComponent('2026-10-06T02:30:00.000Z')}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('notice=taken');
  });

  it('says it is not taking bookings when paused, and gives a generic receipt only for a real reference', async () => {
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    const paused = await get('/b/seido');
    expect(paused.status).toBe(200);
    expect(await paused.text()).toContain('Not taking bookings right now');
    expect((await get('/b/seido/done?ref=K7Q2MP')).status).toBe(200);
    expect((await get('/b/seido/done?ref=<b>')).status).toBe(404);
  });
});

describe('sites: sending a request', () => {
  it('creates the booking, notifies the owner and lands on the receipt', async () => {
    const res = await post(form());
    expect(res.status).toBe(303);
    const location = res.headers.get('Location')!;
    expect(location).toMatch(/^\/b\/seido\/done\?ref=[A-HJ-NP-Z2-9]{6}&lang=en$/);
    const [row] = await asOwner((sql) => sql<{ customer_phone: string; status: string }[]>`select customer_phone, status from booking`);
    expect(row).toEqual({ customer_phone: '60123456789', status: 'pending' });
    expect(await asOwner((sql) => sql`select 1 from notification where kind = 'booking_requested'`)).toHaveLength(1);
    const done = await (await get(location)).text();
    expect(done).toContain(location.split('ref=')[1].slice(0, 6));
    expect(done).not.toContain('Aisyah');
  });

  it('returns the same receipt for a replay, even with the check now failing, and 409 for changed details', async () => {
    const first = await post(form());
    const secret = env({ TURNSTILE_SECRET: 'ts-secret' });
    const replay = await post(form(), secret);
    expect(replay.headers.get('Location')).toBe(first.headers.get('Location'));
    const changed = await post(form({ name: 'Someone else' }), secret);
    expect(changed.status).toBe(409);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
  });

  it('shows the form again for bad fields, a missing check, a sign-in token, and a burst', async () => {
    const bad = await post(form({ name: ' ', phone: '123' }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Please enter a Malaysian phone number.');
    const secret = env({ TURNSTILE_SECRET: 'ts-secret' });
    const missing = await post(form({ submission_key: '44444444-4444-4444-8444-444444444444' }), secret);
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain('Please complete the check before sending.');
    const signin = fetchFake(async (input) => (String(input) === SITEVERIFY
      ? Response.json({ success: true, action: 'signin', hostname: 'sites.test' }) : Response.json({})));
    const wrongToken = await post({ ...form({ submission_key: '55555555-5555-4555-8555-555555555555' }), 'cf-turnstile-response': 'tok' }, secret, signin as unknown as typeof fetch);
    expect(wrongToken.status).toBe(400);
    burstOk = false;
    const braked = await post(form({ submission_key: '66666666-6666-4666-8666-666666666666' }));
    expect(braked.status).toBe(429);
    expect(await braked.text()).toContain('Please try again shortly');
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('shows the form again for a NUL or a direction override, never a failure', async () => {
    const nul = await post(form({ name: 'Ais\u0000yah' }));
    expect(nul.status).toBe(400);
    expect(await nul.text()).toContain('Please enter your name.');
    const note = await post(form({ note: 'Window\u202Eseat' }));
    expect(note.status).toBe(400);
    expect(await note.text()).toContain('Please keep the note under 500 characters.');
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('refuses politely when paused after the form was opened, and when the time was taken', async () => {
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    const paused = await post(form());
    expect(paused.status).toBe(409);
    expect(await paused.text()).toContain('Not taking bookings right now');
    await asOwner((sql) => sql`update booking_settings set accepting = true where business_id = ${A}`);
    await post(form({ party: '2', submission_key: '77777777-7777-4777-8777-777777777777' }));
    const taken = await post(form({ submission_key: '88888888-8888-4888-8888-888888888888' }));
    expect(taken.status).toBe(303);
    expect(taken.headers.get('Location')).toContain('notice=taken');
  });
});

describe('sites: a form sent twice', () => {
  const bookingToken = () => Response.json({ success: true, action: 'booking', hostname: 'sites.test' });

  it('returns the receipt for a form already sent, even after the owner pauses', async () => {
    const first = await post(form());
    expect(first.status).toBe(303);
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    const replay = await post(form());
    expect(replay.status).toBe(303);
    expect(replay.headers.get('Location')).toBe(first.headers.get('Location'));
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    const pausedApp = await post(form());
    expect(pausedApp.headers.get('Location')).toBe(first.headers.get('Location'));

    const changed = await post(form({ name: 'Someone else' }));
    expect(changed.status).toBe(409);
    expect(await changed.text()).toContain('Please start a fresh request');
    const fresh = await post(form({ submission_key: '99999999-9999-4999-8999-999999999999' }));
    expect(fresh.status).toBe(409);
    expect(await fresh.text()).toContain('Not taking bookings right now');

    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
    const perOwner = await asOwner((sql) => sql<{ n: number }[]>`
      select count(*)::int as n from notification where kind = 'booking_requested' group by recipient_user_id`);
    expect(perOwner).toEqual([{ n: 1 }]);
  });

  it('asks Cloudflare with the submission key as the idempotency key', async () => {
    const cloudflare = fetchFake(async () => bookingToken());
    const res = await post({ ...form(), 'cf-turnstile-response': 'tok' }, env({ TURNSTILE_SECRET: 'ts-secret' }),
      cloudflare as unknown as typeof fetch);
    expect(res.status).toBe(303);
    const [url, init] = cloudflare.mock.calls[0];
    expect(String(url)).toBe(SITEVERIFY);
    expect(new URLSearchParams(String(init?.body)).get('idempotency_key')).toBe(form().submission_key);
  });

  it('lands both taps of a double-tap on the same receipt with the check on', async () => {
    /* Cloudflare as documented: a token verifies once; verifying it again
       answers the same only under the idempotency key it was first sent
       with, and timeout-or-duplicate otherwise. Both taps are held at the
       check until both have arrived, so both are past the replay lookup. */
    const spent = new Map<string, string | null>();
    let arrived = 0;
    let bothArrived!: () => void;
    const gate = new Promise<void>((resolve) => { bothArrived = resolve; });
    const cloudflare = fetchFake(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      arrived += 1;
      if (arrived === 2) bothArrived();
      await gate;
      const token = body.get('response') ?? '';
      const key = body.get('idempotency_key');
      if (!spent.has(token)) {
        spent.set(token, key);
        return bookingToken();
      }
      return key !== null && spent.get(token) === key
        ? bookingToken() : Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    });
    const secret = env({ TURNSTILE_SECRET: 'ts-secret' });
    const tapped = { ...form(), 'cf-turnstile-response': 'tok' };
    const taps = await Promise.all([
      post(tapped, secret, cloudflare as unknown as typeof fetch),
      post(tapped, secret, cloudflare as unknown as typeof fetch),
    ]);
    expect(taps.map((r) => r.status)).toEqual([303, 303]);
    expect(taps[1].headers.get('Location')).toBe(taps[0].headers.get('Location'));
    expect(cloudflare).toHaveBeenCalledTimes(2);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
  });
});

describe('sites: turned away before the database', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 404 with the apps switch off, without a database', async () => {
    const off = env({ APPS_ENABLED: 'false', HYPERDRIVE: NOWHERE });
    const page = await get('/b/seido?lang=bm', off);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('Halaman tidak dijumpai');
    expectSecurityHeaders(page);
    expect((await post(form(), off)).status).toBe(404);
    expect(brakeKeys).toEqual([]);
  });

  it('answers 429 from the page brake, keyed by address, without a database', async () => {
    sitesBurstOk = false;
    const res = await get('/b/seido?lang=bm', env({ HYPERDRIVE: NOWHERE }));
    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Sila cuba sebentar lagi');
    expectSecurityHeaders(res);
    expect((await post(form(), env({ HYPERDRIVE: NOWHERE }))).status).toBe(429);
    expect(brakeKeys).toEqual(['site:unknown', 'site:203.0.113.9']);
  });

  it('answers 429 from the booking brake, keyed by address, without a database', async () => {
    burstOk = false;
    const res = await post(form(), env({ HYPERDRIVE: NOWHERE }));
    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Please try again shortly');
    expectSecurityHeaders(res);
    expect(brakeKeys).toEqual(['site:203.0.113.9', 'book:203.0.113.9']);
  });

  it('refuses a body that is not a form with 400, and never as a failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = await sendRaw(JSON.stringify(form()), 'application/json');
    expect(json.status).toBe(400);
    expect(await json.text()).toContain('Please start again');
    expectSecurityHeaders(json);
    const multipart = await sendRaw('--x\r\n', 'multipart/form-data; boundary=x');
    expect(multipart.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('refuses a body over 8 KiB with 413, by its declared length or its real one', async () => {
    const big = await sendRaw(new URLSearchParams(form({ note: 'x'.repeat(9000) })).toString(), 'application/x-www-form-urlencoded');
    expect(big.status).toBe(413);
    expect(await big.text()).toContain('Please start again');
    expectSecurityHeaders(big);
    const declared = await sendRaw('a=b', 'application/x-www-form-urlencoded', { 'Content-Length': '9000' });
    expect(declared.status).toBe(413);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('reads a form whose type carries a parameter or capitals', async () => {
    const res = await handleSites(rawPost(new URLSearchParams(form()).toString(),
      'Application/X-WWW-Form-Urlencoded; charset=UTF-8'), env(), { now: () => NOW });
    expect(res.status).toBe(303);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
  });
});

describe('sites: default export', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries the security headers and never a cookie even when the request throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sitesModule = await import('../src/sites/index');
    const brokenEnv: SitesEnv = {
      ...env(),
      HYPERDRIVE: { connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none' } as SitesEnv['HYPERDRIVE'],
    };
    const res = await sitesModule.default.fetch(new Request('https://sites.test/b/seido'), brokenEnv);
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(spy.mock.calls[0]?.[0]).toBe('sites: request failed');
  });
});
