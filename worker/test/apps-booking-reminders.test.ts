import { beforeEach, describe, expect, it } from 'vitest';
import { cancelBooking, decideBooking } from '../src/apps/bookings/bookings';
import { dispatchBookingReminders } from '../src/apps/bookings/reminders';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-01T00:00:00.000Z');
const START = new Date('2026-10-03T00:00:00.000Z');
const ENV = testEnv({ APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A });
let owner = '';
let service = '';
let booking = '';

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang)
      values (${A}, 'SEIDO Coffee', 'services', true, 'en')`;
    const [user] = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('owner@example.com', true) returning id`;
    owner = user.id;
    await sql`insert into membership (user_id, business_id, role) values (${owner}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at) values (${A}, ${NOW})`;
    const [madeService] = await sql<{ id: string }[]>`insert into booking_service
      (business_id, name, duration_minutes, capacity) values (${A}, 'Cupping class', 60, 4) returning id`;
    service = madeService.id;
    const [madeBooking] = await sql<{ id: string }[]>`insert into booking
      (business_id, reference, submission_key, submission_hash, service_id, service_name,
       starts_at, ends_at, party_size, customer_name, customer_phone)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${service}, 'Cupping class',
       ${START}, ${new Date(START.getTime() + 3_600_000)}, 2, 'Aisyah', '60123456789') returning id`;
    booking = madeBooking.id;
  });
});

async function confirm(now = NOW) {
  const result = await asTenant(A, (tx) => decideBooking(tx, A, booking, 'confirm', owner, now));
  expect(result).toMatchObject({ ok: true, changed: true });
}

describe('booking reminder nudges', () => {
  it('schedules 24-hour and 2-hour prompts, dispatches each once, and queues owner push', async () => {
    await confirm();
    const rows = await asTenant(A, (tx) => tx<{ offset_minutes: number; due_at: Date; status: string }[]>`
      select offset_minutes, due_at, status from booking_reminder order by offset_minutes desc`);
    expect(rows.map((row) => ({ ...row, due_at: row.due_at.toISOString() }))).toEqual([
      { offset_minutes: 1440, due_at: '2026-10-02T00:00:00.000Z', status: 'pending' },
      { offset_minutes: 120, due_at: '2026-10-02T22:00:00.000Z', status: 'pending' },
    ]);

    const tomorrow = new Date('2026-10-02T00:00:00.000Z');
    expect(await dispatchBookingReminders(ENV, { now: tomorrow })).toEqual({ notified: 1, skipped: 0, errors: 0 });
    expect(await dispatchBookingReminders(ENV, { now: tomorrow })).toEqual({ notified: 0, skipped: 0, errors: 0 });
    expect(await dispatchBookingReminders(ENV, { now: new Date('2026-10-02T22:00:00.000Z') }))
      .toEqual({ notified: 1, skipped: 0, errors: 0 });

    const notices = await asTenant(A, (tx) => tx<{ title: string; source_key: string; url: string }[]>`
      select title, source_key, url from notification order by created_at, source_key`);
    expect(notices).toEqual([
      { title: 'WhatsApp reminder due tomorrow', source_key: `booking-reminder:${booking}:1440`, url: `/app?view=apps&app=bookings&booking=${booking}` },
      { title: 'WhatsApp reminder due in 2 hours', source_key: `booking-reminder:${booking}:120`, url: `/app?view=apps&app=bookings&booking=${booking}` },
    ]);
    expect(await asTenant(A, (tx) => tx`select 1 from push_outbox`)).toHaveLength(2);
  });

  it('cancels pending prompts when the booking is cancelled', async () => {
    await confirm();
    const result = await asTenant(A, (tx) => cancelBooking(tx, A, booking, owner, new Date('2026-10-01T01:00:00.000Z')));
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(await asTenant(A, (tx) => tx<{ status: string }[]>`select status from booking_reminder order by offset_minutes`))
      .toEqual([{ status: 'cancelled' }, { status: 'cancelled' }]);
    expect(await dispatchBookingReminders(ENV, { now: new Date('2026-10-02T22:00:00.000Z') }))
      .toEqual({ notified: 0, skipped: 0, errors: 0 });
  });

  it('does not create already-overdue prompts for a late confirmation', async () => {
    const fiveHours = new Date(NOW.getTime() + 5 * 3_600_000);
    await asOwner((sql) => sql`update booking set starts_at = ${fiveHours}, ends_at = ${new Date(fiveHours.getTime() + 3_600_000)} where id = ${booking}`);
    await confirm();
    expect(await asTenant(A, (tx) => tx<{ offset_minutes: number }[]>`select offset_minutes from booking_reminder`))
      .toEqual([{ offset_minutes: 120 }]);
  });
});
