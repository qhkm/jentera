import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  id: null, name: 'Cupping class', description: 'A guided recovery session.', durationMinutes: 60, capacity: 4, priceLabel: 'RM45', active: true,
  hours: [{ weekday: 6, opens: '10:00', closes: '13:00' }], ...over,
});
const config = (over: Record<string, unknown> = {}) => ({
  version: null, slug: 'kedai-aisyah', accepting: true, minNoticeMinutes: 120, changeCutoffMinutes: 360, horizonDays: 30, location: '12 Jalan Example',
  brandColor: '#4aebb5', pageTheme: 'dark', acknowledgeAvailabilityLimits: true, services: [service()], blocks: [], ...over,
});
type Saved = { config: { version: number; installation: { slug: string; publicUrl: string }; settings: { brandColor: string; pageTheme: 'dark' | 'light'; logoUrl: string | null }; services: Array<{ id: string; active: boolean; hours: unknown[] }>; blocks: Array<{ id: string; label: string; startsAt: string; endsAt: string }> } };

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
    expect(saved.config).toMatchObject({ settings: { location: '12 Jalan Example' },
      services: [{ description: 'A guided recovery session.' }] });
    const listed = await jsonOf<{ apps: unknown[] }>(await call('GET', '/api/apps', ownerA));
    expect(listed.apps).toEqual([{ key: 'bookings', state: 'active', accepting: true, publicUrl: 'https://sites.test/b/kedai-aisyah', pending: 0 }]);
  });

  it('says on the apps list when the owner has stopped taking bookings', async () => {
    // The owner's switch lives in booking_settings, not app_installation:
    // Home and Apps read the list, so the list has to carry it.
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: first.config.version, accepting: false, services: [service({ id: first.config.services[0].id })] }));
    const paused = await jsonOf<{ apps: Array<{ state: string; accepting: boolean }> }>(await call('GET', '/api/apps', ownerA));
    expect(paused.apps[0]).toMatchObject({ state: 'active', accepting: false });
    // A settings row this business cannot see (RLS) never reads as its own.
    await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerB, config({ slug: 'kedai-beta' })));
    const again = await jsonOf<{ apps: Array<{ accepting: boolean }> }>(await call('GET', '/api/apps', ownerA));
    expect(again.apps[0].accepting).toBe(false);
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

  it('saves the appearance and uploads, replaces and removes one validated logo', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config({ brandColor: '#62A8FF', pageTheme: 'light' })));
    expect(first.config.settings).toMatchObject({ brandColor: '#62a8ff', pageTheme: 'light', logoUrl: null });
    const objects = new Map<string, Uint8Array>();
    const bucket = {
      put: vi.fn(async (key: string, value: Uint8Array) => { objects.set(key, value); }),
      delete: vi.fn(async (key: string) => { objects.delete(key); }),
    } as unknown as R2Bucket;
    const brandedEnv = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: `${A},${B}`, SITES_ORIGIN: 'https://sites.test', ARTIFACTS: bucket });
    const upload = async (bytes: Uint8Array, type = 'image/png') => {
      const shaped = req('PUT', '/api/apps/bookings/logo', { cookie: ownerA });
      const headers = new Headers(shaped.request.headers);
      headers.set('Origin', CORS['Access-Control-Allow-Origin']);
      headers.set('Content-Type', type);
      return (await handleApps(new Request(shaped.request, { headers, body: bytes }), brandedEnv, shaped.url, CORS))!;
    };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const uploaded = await jsonOf<Saved>(await upload(png));
    expect(uploaded.config.version).toBe(2);
    expect(uploaded.config.settings.logoUrl).toMatch(/^https:\/\/sites\.test\/b\/kedai-aisyah\/logo\?v=/);
    expect(objects.size).toBe(1);
    expect((await upload(new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect(objects.size).toBe(1);
    const removed = await jsonOf<Saved>(await call('DELETE', '/api/apps/bookings/logo', ownerA, undefined, brandedEnv));
    expect(removed.config.version).toBe(3);
    expect(removed.config.settings.logoUrl).toBeNull();
    expect(objects.size).toBe(0);
  });

  it('creates, updates and removes manual closures with the rest of the versioned config', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config({
      blocks: [{ id: null, label: 'Team retreat', startsAt: '2026-10-12T01:00:00.000Z', endsAt: '2026-10-12T09:00:00.000Z' }],
    })));
    expect(first.config.blocks).toEqual([expect.objectContaining({ label: 'Team retreat' })]);
    const block = first.config.blocks[0];
    const serviceId = first.config.services[0].id;
    const second = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config({
      version: first.config.version,
      services: [service({ id: serviceId })],
      blocks: [{ id: block.id, label: 'Closed for training', startsAt: block.startsAt, endsAt: block.endsAt }],
    })));
    expect(second.config.blocks).toEqual([expect.objectContaining({ id: block.id, label: 'Closed for training' })]);
    const removed = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config({
      version: second.config.version,
      services: [service({ id: serviceId })],
      blocks: [],
    })));
    expect(removed.config.blocks).toEqual([]);
  });

  it('refuses malformed, duplicate and cross-tenant closure ids', async () => {
    const bad = await call('PUT', '/api/apps/bookings/config', ownerA, config({
      blocks: [{ id: null, label: 'Too long', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-02T00:00:00.000Z' }],
    }));
    expect(bad.status).toBe(400);
    const beta = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerB, config({
      slug: 'beta-salon', blocks: [{ id: null, label: 'Beta closure', startsAt: '2026-10-02T00:00:00.000Z', endsAt: '2026-10-03T00:00:00.000Z' }],
    })));
    const stolen = beta.config.blocks[0];
    const attempt = await call('PUT', '/api/apps/bookings/config', ownerA, config({
      blocks: [{ ...stolen }, { ...stolen }],
    }));
    expect(attempt.status).toBe(400);
    const crossTenant = await call('PUT', '/api/apps/bookings/config', ownerA, config({ blocks: [stolen] }));
    expect(crossTenant.status).toBe(409);
    expect(await crossTenant.json()).toMatchObject({ code: 'CONFIG_CHANGED' });
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

  it('keeps a renamed link name with its business: another business cannot take it, the owner can return to it', async () => {
    const first = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerA, config()));
    const svc = first.config.services[0].id;
    expect((await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 1, slug: 'kedai-baru', services: [service({ id: svc })] }))).status).toBe(200);
    const taken = await call('PUT', '/api/apps/bookings/config', ownerB, config());
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    expect((await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ version: 2, slug: 'kedai-aisyah', services: [service({ id: svc })] }))).status).toBe(200);
    const names = await asOwner((sql) => sql<{ public_slug: string }[]>`
      select public_slug from app_slug where business_id = ${A} order by public_slug`);
    expect(names.map((n) => n.public_slug)).toEqual(['kedai-aisyah', 'kedai-baru']);
  });

  it('refuses a service id that belongs to another business', async () => {
    const other = await jsonOf<Saved>(await call('PUT', '/api/apps/bookings/config', ownerB, config({ slug: 'beta-salon' })));
    const res = await call('PUT', '/api/apps/bookings/config', ownerA,
      config({ services: [service({ id: other.config.services[0].id })] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'UNKNOWN_SERVICE' });
  });
});
