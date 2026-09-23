import { beforeEach, describe, expect, it } from 'vitest';
import { handleApps } from '../src/routes/apps';
import { asOwner, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };
const ENV = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: `${A},${B}`, SITES_ORIGIN: 'https://sites.test' });
let ownerA = '';
let ownerB = '';
let staffA = '';

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'Alpha', 'services', true), (${B}, 'Beta', 'salon', true)`;
    await sql`update business set plan = 'team' where id = ${A}`;
    const users = await sql<{ id: string; email: string }[]>`
      insert into app_user (email, email_verified)
      values ('a@example.com', true), ('b@example.com', true), ('s@example.com', true) returning id, email`;
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${byEmail['a@example.com']}, ${A}, 'owner'), (${byEmail['b@example.com']}, ${B}, 'owner'),
      (${byEmail['s@example.com']}, ${A}, 'staff')`;
    return byEmail;
  });
  ownerA = await signIn(ids['a@example.com']);
  ownerB = await signIn(ids['b@example.com']);
  staffA = await signIn(ids['s@example.com']);
});

async function call(method: string, path: string, cookie: string, body?: unknown, env = ENV) {
  const shaped = req(method, path, { cookie, body });
  const headers = new Headers(shaped.request.headers);
  headers.set('Origin', CORS['Access-Control-Allow-Origin']);
  const res = await handleApps(new Request(shaped.request, { headers }), env, shaped.url, CORS);
  if (!res) throw new Error('apps route did not handle the request');
  return res;
}

const service = (over: Record<string, unknown> = {}) => ({
  id: null, name: 'Cupping class', durationMinutes: 60, capacity: 4, priceLabel: 'RM45', active: true,
  hours: [{ weekday: 6, opens: '10:00', closes: '13:00' }], ...over,
});
const config = (over: Record<string, unknown> = {}) => ({
  version: null, slug: 'kedai-aisyah', accepting: true, minNoticeMinutes: 120, horizonDays: 30,
  acknowledgeAvailabilityLimits: true, services: [service()], ...over,
});
type Saved = { config: { version: number; installation: { slug: string; publicUrl: string }; services: Array<{ id: string; active: boolean; hours: unknown[] }> } };

describe('apps route: access', () => {
  it('answers 404 for a business outside the pilot, and when the switch is off', async () => {
    const onlyB = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: B, SITES_ORIGIN: 'https://sites.test' });
    expect((await call('GET', '/api/apps', ownerA, undefined, onlyB)).status).toBe(404);
    const off = testEnv({ APPS_ENABLED: 'false', APPS_BUSINESS_IDS: A });
    expect((await call('GET', '/api/apps', ownerA, undefined, off)).status).toBe(404);
  });
  it('is owner only, private and uncached', async () => {
    expect((await call('GET', '/api/apps', staffA)).status).toBe(403);
    expect((await call('PUT', '/api/apps/bookings/config', staffA, config())).status).toBe(403);
    const res = await call('GET', '/api/apps', ownerA);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ ok: true, apps: [], available: ['bookings'] });
  });
});

describe('apps route: config', () => {
  it('installs on the first save only with the availability acknowledgement', async () => {
    const refused = await call('PUT', '/api/apps/bookings/config', ownerA, config({ acknowledgeAvailabilityLimits: false }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'ACK_REQUIRED' });
    const saved = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    expect(saved.config.version).toBe(1);
    expect(saved.config.installation).toMatchObject({ slug: 'kedai-aisyah', publicUrl: 'https://sites.test/b/kedai-aisyah' });
    const listed = await jsonOf<{ apps: unknown[] }>(await call('GET', '/api/apps', ownerA));
    expect(listed.apps).toEqual([{ key: 'bookings', state: 'active', publicUrl: 'https://sites.test/b/kedai-aisyah', pending: 0 }]);
  });

  it('versions every save and refuses a stale one', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    const again = await call('PUT', '/api/apps/bookings/config', ownerA, config());
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'CONFIG_CHANGED' });
    const svc = first.config.services[0];
    const second = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, services: [service({ id: svc.id, name: 'Cupping' })] })));
    expect(second.config.version).toBe(2);
    expect((await call('PUT', '/api/apps/bookings/config', ownerA, config({ version: 1, services: [service({ id: svc.id })] }))).status).toBe(409);
  });

  it('normalises the link name, and refuses taken or reserved ones', async () => {
    const saved = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config({ slug: '  Kedai-Aisyah ' })));
    expect(saved.config.installation.slug).toBe('kedai-aisyah');
    const taken = await call('PUT', '/api/apps/bookings/config', ownerB, config());
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    expect((await call('PUT', '/api/apps/bookings/config', ownerB, config({ slug: 'api' }))).status).toBe(400);
    expect(await asOwner((sql) => sql`select 1 from app_installation where business_id = ${B}`)).toHaveLength(0);
  });

  it('refuses midnight closing, overnight and overlapping hours, bad durations, and no active service', async () => {
    const bad = [
      config({ services: [service({ hours: [{ weekday: 1, opens: '18:00', closes: '24:00' }] })] }),
      config({ services: [service({ hours: [{ weekday: 1, opens: '22:00', closes: '02:00' }] })] }),
      config({ services: [service({ hours: [{ weekday: 1, opens: '09:00', closes: '12:00' }, { weekday: 1, opens: '11:00', closes: '14:00' }] })] }),
      config({ services: [service({ durationMinutes: 20 })] }),
      config({ services: [service({ active: false })] }),
      config({ services: [] }),
    ];
    for (const body of bad) expect((await call('PUT', '/api/apps/bookings/config', ownerA, body)).status).toBe(400);
  });

  it('deactivates a removed service that has bookings and deletes an unused one', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ services: [service(), service({ name: 'Private tasting' })] })));
    const [used, unused] = first.config.services;
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${used.id}, 'Cupping class',
        now() + interval '2 days', now() + interval '2 days 1 hour', 1, 'Aisyah', '60123456789')`);
    const replacement = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, services: [service({ name: 'Espresso basics' })] })));
    const ids = replacement.config.services.map((s) => [s.id, s.active]);
    expect(ids).toContainEqual([used.id, false]);
    expect(ids.find(([id]) => id === unused.id)).toBeUndefined();
  });

  it('refuses to cut capacity below places already held, and rolls back the whole save', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    const svc = first.config.services[0];
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${svc.id}, 'Cupping class',
        now() + interval '2 days', now() + interval '2 days 1 hour', 3, 'Aisyah', '60123456789')`);
    const res = await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, slug: 'renamed', services: [service({ id: svc.id, capacity: 2 })] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'CAPACITY_BELOW_RESERVED', serviceId: svc.id });
    const [row] = await asOwner((sql) => sql<{ public_slug: string; config_version: number }[]>`
      select public_slug, config_version from app_installation where business_id = ${A}`);
    expect(row).toEqual({ public_slug: 'kedai-aisyah', config_version: 1 });
  });

  it('refuses a service id that belongs to another business', async () => {
    const other = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerB, config({ slug: 'beta-salon' })));
    const res = await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ services: [service({ id: other.config.services[0].id })] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'UNKNOWN_SERVICE' });
  });
});
