import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSites } from '../src/sites/index';
import type { SitesEnv } from '../src/sites/env';
import { SITEVERIFY } from '../src/turnstile';
import { asOwner, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-05T00:00:00Z'); // Mon 08:00 Malaysia
const TEN = '2026-10-06T02:00:00.000Z';       // Tue 10:00 Malaysia
let service = '';
let burstOk = true;

const env = (over: Partial<SitesEnv> = {}): SitesEnv => ({
  HYPERDRIVE: testEnv().HYPERDRIVE,
  APPS_ENABLED: 'true',
  APPS_BUSINESS_IDS: A,
  SITES_ORIGIN: 'https://sites.test',
  TURNSTILE_SITE_KEY: 'site-key',
  BOOKING_BURST: { limit: async () => ({ success: burstOk }) } as unknown as RateLimit,
  ...over,
});

beforeEach(async () => {
  burstOk = true;
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
    expect((await post(form({ submission_key: '66666666-6666-4666-8666-666666666666' }))).status).toBe(429);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('refuses politely when paused after the form was opened, and when the time was taken', async () => {
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    const paused = await post(form());
    expect(await paused.text()).toContain('Not taking bookings right now');
    await asOwner((sql) => sql`update booking_settings set accepting = true where business_id = ${A}`);
    await post(form({ party: '2', submission_key: '77777777-7777-4777-8777-777777777777' }));
    const taken = await post(form({ submission_key: '88888888-8888-4888-8888-888888888888' }));
    expect(taken.status).toBe(303);
    expect(taken.headers.get('Location')).toContain('notice=taken');
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
