import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginCustomerSession, cancelByCustomer, loadManagedBooking, rescheduleByCustomer,
} from '../src/apps/bookings/customer';
import { createBookingRequest, submissionDigest, type RequestInput } from '../src/apps/bookings/request';
import { asOwner, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const ENV = testEnv();
const NOW = new Date('2026-10-05T00:00:00Z');
const TEN = new Date('2026-10-06T02:00:00Z');
const ELEVEN = new Date('2026-10-06T03:00:00Z');
let service = '';

beforeEach(async () => {
  await truncateAll();
  service = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang)
      values (${A}, 'SEIDO Coffee', 'services', true, 'en')`;
    const [owner] = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('owner@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${owner.id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days)
      values (${A}, ${NOW}, 120, 30)`;
    const [created] = await sql<{ id: string }[]>`insert into booking_service
      (business_id, name, duration_minutes, capacity) values (${A}, 'Cupping class', 60, 1) returning id`;
    await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes)
      values (${A}, ${created.id}, 2, '10:00', '13:00')`;
    return created.id;
  });
});

const request = (): RequestInput => ({
  serviceId: service, startsAt: TEN, partySize: 1, name: 'Aisyah', phone: '60123456789', note: 'Window',
  submissionKey: crypto.randomUUID(),
});

async function booked() {
  const input = request();
  const result = await createBookingRequest(ENV, A, input, await submissionDigest(input), NOW);
  if (result.kind !== 'created') throw new Error(`fixture booking failed: ${result.kind}`);
  return result;
}

async function session(reference: string, at = NOW) {
  const result = await beginCustomerSession(ENV, A, reference, '012-345 6789', at);
  if (!result) throw new Error('fixture session failed');
  return result.token;
}

describe('customer booking access', () => {
  it('requires both the reference and normalized WhatsApp number and expires the opaque session', async () => {
    const booking = await booked();
    expect(await beginCustomerSession(ENV, A, booking.reference, '0199999999', NOW)).toBeNull();
    expect(await beginCustomerSession(ENV, A, 'AAAAAA', '0123456789', NOW)).toBeNull();
    const token = await session(booking.reference);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await loadManagedBooking(ENV, A, token, NOW)).toMatchObject({ reference: booking.reference, status: 'pending' });
    expect(await loadManagedBooking(ENV, A, token, new Date(NOW.getTime() + 2 * 60 * 60_000 + 1))).toBeNull();
    const [stored] = await asOwner((sql) => sql<{ token_hash: string }[]>`select token_hash from booking_customer_session`);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toContain(token);
  });

  it('lets a customer cancel a pending booking once, releases capacity, and notifies the owner', async () => {
    const original = await booked();
    const token = await session(original.reference);
    expect((await cancelByCustomer(ENV, A, token, NOW)).kind).toBe('changed');
    expect((await cancelByCustomer(ENV, A, token, NOW)).kind).toBe('same');
    const [row] = await asOwner((sql) => sql<{ status: string; customer_cancelled_at: Date; cancelled_by: string | null }[]>`
      select status, customer_cancelled_at, cancelled_by from booking where id = ${original.bookingId}`);
    expect(row).toMatchObject({ status: 'cancelled', cancelled_by: null });
    expect(row.customer_cancelled_at.toISOString()).toBe(NOW.toISOString());
    const notices = await asOwner((sql) => sql<{ title: string }[]>`
      select title from notification where source_key = ${`booking-customer-cancelled:${original.bookingId}`}`);
    expect(notices).toEqual([{ title: 'Booking cancelled by customer' }]);
    expect((await booked()).kind).toBe('created');
  });

  it('atomically replaces a booking with a fresh pending request and keeps the session on it', async () => {
    const original = await booked();
    const token = await session(original.reference);
    const changed = await rescheduleByCustomer(ENV, A, token, ELEVEN, NOW);
    expect(changed.kind).toBe('changed');
    if (changed.kind !== 'changed') return;
    expect(changed.booking).toMatchObject({ startsAt: ELEVEN, status: 'pending' });
    expect(changed.booking.reference).not.toBe(original.reference);
    const rows = await asOwner((sql) => sql<{ id: string; status: string; rescheduled_from_id: string | null; rescheduled_to_id: string | null }[]>`
      select id, status, rescheduled_from_id, rescheduled_to_id from booking order by created_at, id`);
    const old = rows.find((row) => row.id === original.bookingId)!;
    const fresh = rows.find((row) => row.id === changed.booking.id)!;
    expect(old).toMatchObject({ status: 'cancelled', rescheduled_to_id: fresh.id });
    expect(fresh).toMatchObject({ status: 'pending', rescheduled_from_id: old.id });
    expect(await loadManagedBooking(ENV, A, token, NOW)).toMatchObject({ id: fresh.id, startsAt: ELEVEN });
    expect(await rescheduleByCustomer(ENV, A, token, ELEVEN, NOW)).toMatchObject({ kind: 'same' });
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(2);
    const [notice] = await asOwner((sql) => sql<{ title: string; url: string }[]>`
      select title, url from notification where source_key = ${`booking-rescheduled:${fresh.id}`}`);
    expect(notice).toMatchObject({ title: 'Reschedule request', url: `/app?view=apps&app=bookings&booking=${fresh.id}` });
  });

  it('queues removal of a confirmed Calendar event on cancellation', async () => {
    const original = await booked();
    await asOwner((sql) => sql`update booking set status = 'confirmed', decided_at = ${NOW}, calendar_status = 'created'
      where business_id = ${A} and id = ${original.bookingId}`);
    const token = await session(original.reference);
    expect(await cancelByCustomer(ENV, A, token, NOW)).toMatchObject({ kind: 'changed', calendarBookingId: original.bookingId });
    const [job] = await asOwner((sql) => sql<{ desired: string; revision: number }[]>`
      select desired, revision from booking_calendar_job where business_id = ${A} and booking_id = ${original.bookingId}`);
    expect(job).toMatchObject({ desired: 'absent', revision: 1 });
    const [row] = await asOwner((sql) => sql<{ calendar_status: string }[]>`
      select calendar_status from booking where business_id = ${A} and id = ${original.bookingId}`);
    expect(row.calendar_status).toBe('pending');
  });

  it('leaves the original untouched when the replacement time was taken or changes are paused', async () => {
    const original = await booked();
    const token = await session(original.reference);
    const other = request();
    other.startsAt = ELEVEN;
    expect((await createBookingRequest(ENV, A, other, await submissionDigest(other), NOW)).kind).toBe('created');
    expect((await rescheduleByCustomer(ENV, A, token, ELEVEN, NOW)).kind).toBe('taken');
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    expect((await rescheduleByCustomer(ENV, A, token, new Date('2026-10-06T04:00:00Z'), NOW)).kind).toBe('unavailable');
    const [old] = await asOwner((sql) => sql<{ status: string }[]>`select status from booking where id = ${original.bookingId}`);
    expect(old.status).toBe('pending');
  });
});
