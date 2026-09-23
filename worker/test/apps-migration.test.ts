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
    await sql`insert into app_slug (public_slug, business_id, app_key)
      values ('alpha-studio', ${A}, 'bookings'), ('beta-salon', ${B}, 'bookings')`;
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
    expect(found).toEqual({ business_id: A, current_slug: 'alpha-studio' });
    const missing = await asApp((sql) => sql`select * from public.bookings_by_slug('nobody')`);
    expect(missing).toHaveLength(0);
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    const paused = await asApp((sql) => sql`select * from public.bookings_by_slug('alpha-studio')`);
    expect(paused).toHaveLength(1);
  });

  it('resolves a name the business used before to its current name', async () => {
    await asOwner((sql) => sql`insert into app_slug (public_slug, business_id, app_key)
      values ('alpha-old', ${A}, 'bookings')`);
    const [found] = await asApp((sql) => sql`select * from public.bookings_by_slug('alpha-old')`);
    expect(found).toEqual({ business_id: A, current_slug: 'alpha-studio' });
  });

  it('never lets a second business register a name another business holds', async () => {
    await expect(asTenant(B, (tx) => tx`
      insert into app_slug (public_slug, business_id, app_key) values ('alpha-studio', ${B}, 'bookings')`))
      .rejects.toThrow(/app_slug_pkey|duplicate key/);
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

/** Exactly what saveConfig's URL check needs: the pattern and the bound,
    not merely that the column exists. Guards the apply script's own check
    of the same constraint. */
describe('notification url constraint', () => {
  it('holds the workspace-path pattern and the 300-character bound', async () => {
    const [row] = await asOwner((sql) => sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'public.notification'::regclass and conname = 'notification_url_check'`);
    expect(row.def).toContain('300');
    expect(row.def).toContain('^/app([/?#]|$)');
  });
});

/** The six Bookings tables: every row is invisible to another tenant, and
    aisar_app holds exactly the privileges the routes use — no more. Only
    booking_service (unused services are deleted) and booking_hours (hours
    are replaced) get DELETE; booking records are retained, so the other
    four tables must not. */
describe('grants and row-level security on the Bookings tables', () => {
  const EXPECTED: Record<string, string[]> = {
    app_installation: ['select', 'insert', 'update'],
    app_slug: ['select', 'insert'],
    booking_settings: ['select', 'insert', 'update'],
    booking_service: ['select', 'insert', 'update', 'delete'],
    booking_hours: ['select', 'insert', 'update', 'delete'],
    booking: ['select', 'insert', 'update'],
    booking_calendar_job: ['select', 'insert', 'update'],
  };
  const ALL_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

  let serviceA = '';
  let bookingA = '';

  beforeEach(async () => {
    await asOwner(async (sql) => {
      await sql`insert into booking_settings (business_id, availability_acknowledged_at) values
        (${A}, now()), (${B}, now())`;
      const services = await sql<{ id: string; business_id: string }[]>`
        insert into booking_service (business_id, name, duration_minutes, capacity)
        values (${A}, 'Cupping class', 60, 4), (${B}, 'Haircut', 30, 1)
        returning id, business_id`;
      const svcA = services.find((s) => s.business_id === A)!.id;
      const svcB = services.find((s) => s.business_id === B)!.id;
      serviceA = svcA;
      await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes) values
        (${A}, ${svcA}, 1, '09:00', '17:00'), (${B}, ${svcB}, 1, '09:00', '17:00')`;
      const bookings = await sql<{ id: string; business_id: string }[]>`
        insert into booking (business_id, reference, submission_key, submission_hash, service_id, service_name,
          starts_at, ends_at, party_size, customer_name, customer_phone, status)
        values
          (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${svcA}, 'Cupping class',
            now() + interval '1 day', now() + interval '1 day 1 hour', 2, 'Aisyah', '60123456789', 'confirmed'),
          (${B}, 'M8R3NQ', gen_random_uuid(), 'h', ${svcB}, 'Haircut',
            now() + interval '1 day', now() + interval '1 day 1 hour', 1, 'Aina', '60123456780', 'confirmed')
        returning id, business_id`;
      bookingA = bookings.find((b) => b.business_id === A)!.id;
      const bookingB = bookings.find((b) => b.business_id === B)!.id;
      await sql`insert into booking_calendar_job (business_id, booking_id, desired) values
        (${A}, ${bookingA}, 'present'), (${B}, ${bookingB}, 'present')`;
    });
  });

  for (const table of Object.keys(EXPECTED)) {
    it(`isolates ${table} rows to their own tenant`, async () => {
      const rows = await asTenant(A, (tx) => tx.unsafe(`select business_id from ${table}`)) as { business_id: string }[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.business_id).toBe(A);
      const rowsB = await asTenant(B, (tx) => tx.unsafe(`select business_id from ${table}`)) as { business_id: string }[];
      expect(rowsB.length).toBeGreaterThan(0);
      for (const row of rowsB) expect(row.business_id).toBe(B);
    });
  }

  for (const [table, expected] of Object.entries(EXPECTED)) {
    it(`grants aisar_app exactly ${expected.join('/')} on ${table}`, async () => {
      const held = await asApp(async (sql) => {
        const out: Record<string, boolean> = {};
        for (const privilege of ALL_PRIVILEGES) {
          const [row] = await sql<{ ok: boolean }[]>`
            select has_table_privilege('aisar_app', ${'public.' + table}, ${privilege}) as ok`;
          out[privilege.toLowerCase()] = row.ok;
        }
        return out;
      });
      for (const privilege of ALL_PRIVILEGES) {
        const key = privilege.toLowerCase();
        expect(held[key], `${table}.${key}`).toBe(expected.includes(key));
      }
    });
  }

  it('refuses to delete a booking record as the tenant', async () => {
    await expect(asTenant(A, (tx) => tx`delete from booking where business_id = ${A} and id = ${bookingA}`))
      .rejects.toThrow(/permission denied/);
  });

  it('refuses to truncate any of the six tables as the tenant', async () => {
    for (const table of Object.keys(EXPECTED)) {
      await expect(asTenant(A, (tx) => tx.unsafe(`truncate ${table}`)))
        .rejects.toThrow(/permission denied/);
    }
  });

  it('still lets the tenant delete an unused service and its hours', async () => {
    // serviceA carries no booking references in this sub-test's own fixture
    // besides bookingA above, which references it — insert a second, unused
    // service to prove delete privilege itself, independent of the app's
    // own "used services are only deactivated" business rule.
    const unused = await asOwner(async (sql) => {
      const [s] = await sql<{ id: string }[]>`
        insert into booking_service (business_id, name, duration_minutes, capacity)
        values (${A}, 'Unused service', 30, 1) returning id`;
      await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes)
        values (${A}, ${s.id}, 2, '09:00', '12:00')`;
      return s.id;
    });
    await asTenant(A, (tx) => tx`delete from booking_hours where business_id = ${A} and service_id = ${unused}`);
    await asTenant(A, (tx) => tx`delete from booking_service where business_id = ${A} and id = ${unused}`);
    const left = await asOwner((sql) => sql`select 1 from booking_service where id = ${unused}`);
    expect(left).toHaveLength(0);
  });
});
