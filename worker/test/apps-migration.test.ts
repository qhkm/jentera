import { beforeEach, describe, expect, it } from 'vitest';
import { asApp, asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'Alpha', 'services', true), (${B}, 'Beta', 'salon', true)`;
    await sql`insert into app_installation (business_id, app_key, public_slug)
      values (${A}, 'bookings', 'alpha-studio'), (${B}, 'bookings', 'beta-salon')`;
  });
});

describe('apps and bookings schema', () => {
  it('scopes installations to the tenant and refuses writes for another business', async () => {
    const rows = await asTenant(A, (tx) => tx<{ public_slug: string }[]>`
      select public_slug from app_installation`);
    expect(rows.map((r) => r.public_slug)).toEqual(['alpha-studio']);
    await expect(asTenant(A, (tx) => tx`
      insert into booking_settings (business_id, availability_acknowledged_at)
      values (${B}, now())`)).rejects.toThrow(/row-level security/);
  });

  it('resolves a public slug to a business id and nothing else', async () => {
    const [found] = await asApp((sql) => sql<{ business_id: string }[]>`
      select * from public.bookings_by_slug('alpha-studio')`);
    expect(found).toEqual({ business_id: A });
    const missing = await asApp((sql) => sql`select * from public.bookings_by_slug('nobody')`);
    expect(missing).toHaveLength(0);
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    const paused = await asApp((sql) => sql`select * from public.bookings_by_slug('alpha-studio')`);
    expect(paused).toHaveLength(1);
  });

  it('refuses slugs outside the pattern, and duplicates across businesses', async () => {
    await expect(asOwner((sql) => sql`
      update app_installation set public_slug = 'Bad Slug' where business_id = ${A}`)).rejects.toThrow();
    await expect(asOwner((sql) => sql`
      update app_installation set public_slug = 'beta-salon' where business_id = ${A}`)).rejects.toThrow(/app_installation_slug/);
  });

  it('accepts booking_requested notifications with an internal url only', async () => {
    const [user] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('o@example.com', true) returning id`);
    await asOwner((sql) => sql`
      insert into notification (business_id, recipient_user_id, kind, title, body, source_key, url)
      values (${A}, ${user.id}, 'booking_requested', 'New booking', 'Aisyah, Sat 3 pm', 'booking:1',
              '/app?view=apps&app=bookings&booking=1')`);
    await expect(asOwner((sql) => sql`
      insert into notification (business_id, recipient_user_id, kind, title, body, source_key, url)
      values (${A}, ${user.id}, 'booking_requested', 't', 'b', 'booking:2', 'https://evil.example')`))
      .rejects.toThrow(/notification_url_check/);
  });

  it('lists due calendar jobs by id only, skipping leased and completed ones', async () => {
    const service = await asOwner(async (sql) => {
      const [s] = await sql<{ id: string }[]>`
        insert into booking_service (business_id, name, duration_minutes, capacity)
        values (${A}, 'Cupping class', 60, 4) returning id`;
      return s.id;
    });
    const booking = await asOwner(async (sql) => {
      const [b] = await sql<{ id: string }[]>`
        insert into booking (business_id, reference, submission_key, submission_hash, service_id,
          service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status)
        values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${service}, 'Cupping class',
          now() + interval '1 day', now() + interval '1 day 1 hour', 2, 'Aisyah', '60123456789', 'confirmed')
        returning id`;
      await sql`insert into booking_calendar_job (business_id, booking_id, desired) values (${A}, ${b.id}, 'present')`;
      return b.id;
    });
    const due = await asApp((sql) => sql`select * from public.booking_calendar_due(now(), 50)`);
    expect(due).toEqual([{ business_id: A, booking_id: booking }]);
    await asOwner((sql) => sql`update booking_calendar_job set lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '1 minute' where booking_id = ${booking}`);
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(now(), 50)`)).toHaveLength(0);
    await asOwner((sql) => sql`update booking_calendar_job set lease_token = null, lease_expires_at = null,
      completed_revision = revision where booking_id = ${booking}`);
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(now(), 50)`)).toHaveLength(0);
  });
});
