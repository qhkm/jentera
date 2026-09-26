import { beforeEach, describe, expect, it } from 'vitest';
import { loadOpenTimes, loadPublicPage, resolvePublicSlug } from '../src/apps/bookings/public';
import { asOwner, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ENV = testEnv();
// Monday 5 Oct 2026, 08:00 in Malaysia. Tuesday 6 Oct is weekday 2.
const NOW = new Date('2026-10-05T00:00:00Z');
let serviceA = '';
let serviceB = '';

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang)
      values (${A}, 'SEIDO <Coffee>', 'services', true, 'en'), (${B}, 'Beta', 'salon', true, 'bm')`;
    await sql`insert into app_installation (business_id, app_key, public_slug)
      values (${A}, 'bookings', 'seido'), (${B}, 'bookings', 'beta')`;
    await sql`insert into app_slug (public_slug, business_id, app_key)
      values ('seido', ${A}, 'bookings'), ('seido-lama', ${A}, 'bookings'), ('beta', ${B}, 'bookings')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days, location)
      values (${A}, now(), 120, 30, '12 Jalan Example'), (${B}, now(), 0, 30, null)`;
    const [a] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, description, duration_minutes, capacity)
      values (${A}, 'Cupping class', 'A guided recovery session.', 60, 2) returning id`;
    await sql`insert into booking_service (business_id, name, duration_minutes, capacity, active)
      values (${A}, 'Old workshop', 60, 2, false)`;
    const [b] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${B}, 'Haircut', 30, 1) returning id`;
    await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes)
      values (${A}, ${a.id}, 2, '10:00', '13:00'), (${B}, ${b.id}, 2, '10:00', '11:00')`;
    return { a: a.id, b: b.id };
  });
  serviceA = ids.a;
  serviceB = ids.b;
});

describe('public reads', () => {
  it('resolves current and held names, and nothing for unknown ones', async () => {
    expect(await resolvePublicSlug(ENV, 'seido')).toEqual({ businessId: A, currentSlug: 'seido' });
    expect(await resolvePublicSlug(ENV, 'seido-lama')).toEqual({ businessId: A, currentSlug: 'seido' });
    expect(await resolvePublicSlug(ENV, 'nobody')).toBeNull();
  });

  it('lists only active services, and reports whether the page is open', async () => {
    const page = await loadPublicPage(ENV, A);
    expect(page).toMatchObject({ businessName: 'SEIDO <Coffee>', lang: 'en', open: true,
      settings: { location: '12 Jalan Example', pageTheme: 'dark' }, services: [{ description: 'A guided recovery session.' }] });
    expect(page!.services.map((s) => s.name)).toEqual(['Cupping class']);
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    expect((await loadPublicPage(ENV, A))!.open).toBe(false);
    await asOwner((sql) => sql`update booking_settings set accepting = true where business_id = ${A}`);
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    expect((await loadPublicPage(ENV, A))!.open).toBe(false);
  });

  it('offers open times with places left, minus held places, per Malaysian day', async () => {
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status)
      values
        (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${serviceA}, 'Cupping class',
          '2026-10-06T02:00:00Z', '2026-10-06T03:00:00Z', 2, 'Aisyah', '60123456789', 'pending'),
        (${A}, 'M3RT9X', gen_random_uuid(), 'h', ${serviceA}, 'Cupping class',
          '2026-10-06T03:00:00Z', '2026-10-06T04:00:00Z', 2, 'Farah', '60123456780', 'declined'),
        (${A}, 'Q8LB4Z', gen_random_uuid(), 'h', ${serviceA}, 'Cupping class',
          '2026-10-06T03:00:00Z', '2026-10-06T04:00:00Z', 2, 'Hakim', '60123456781', 'cancelled')`);
    const times = await loadOpenTimes(ENV, A, serviceA, '2026-10-06', 1, NOW);
    expect(times!.days).toHaveLength(1);
    // The 11:00 slot overlaps a declined and a cancelled booking, both for
    // its full capacity: neither holds a place, so it still shows 2 left.
    expect(times!.days[0].slots.map((s) => [s.startsAt.toISOString(), s.remaining])).toEqual([
      ['2026-10-06T03:00:00.000Z', 2], ['2026-10-06T04:00:00.000Z', 2],
    ]);
  });

  it('removes manual closures and cached Google busy time without exposing event details', async () => {
    await asOwner(async (sql) => {
      const [connection] = await sql<{ id: string }[]>`insert into connection
        (business_id, connector, method, status) values (${A}, 'google', 'oauth', 'connected') returning id`;
      await sql`insert into booking_block (business_id, label, starts_at, ends_at)
        values (${A}, 'Private event', '2026-10-06T03:00:00Z', '2026-10-06T04:00:00Z')`;
      await sql`insert into booking_calendar_busy
        (business_id, connection_id, event_key, starts_at, ends_at)
        values (${A}, ${connection.id}, 'provider-opaque-id', '2026-10-06T04:00:00Z', '2026-10-06T05:00:00Z')`;
    });
    const times = await loadOpenTimes(ENV, A, serviceA, '2026-10-06', 1, NOW);
    expect(times!.days[0].slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-10-06T02:00:00.000Z',
    ]);
  });

  it('starts from today when asked for a past date, and refuses other businesses\' or inactive services', async () => {
    const times = await loadOpenTimes(ENV, A, serviceA, '2026-09-01', 3, NOW);
    expect(times!.days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(await loadOpenTimes(ENV, A, serviceB, '2026-10-06', 1, NOW)).toBeNull();
    const [inactive] = await asOwner((sql) => sql<{ id: string }[]>`
      select id from booking_service where business_id = ${A} and not active`);
    expect(await loadOpenTimes(ENV, A, inactive.id, '2026-10-06', 1, NOW)).toBeNull();
  });
});
