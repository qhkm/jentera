import type postgres from 'postgres';
import { withTenant, type DatabaseEnv } from '../../db';
import { createNotification } from '../../notifications/store';
import { ownersOf } from '../../notifications/recipients';
import type { BookingStatus, CalendarStatus } from './bookings';
import { queueCalendarJob } from './calendar-job';
import { readHours } from './hours';
import { whenText, type Lang } from './messages';
import { normalizeMyPhone } from './phone';
import { reservationsFor } from './public';
import { newReference } from './reference';
import { openSlots } from './slots';
import { addDays, myDate, myInstant } from './time';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_MS = 2 * 60 * 60_000;
const REFERENCE_ATTEMPTS = 5;

export interface ManagedBooking {
  id: string;
  reference: string;
  serviceId: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  customerName: string;
  status: BookingStatus;
  customerCancelledAt: Date | null;
}

interface ManagedRow {
  id: string;
  reference: string;
  service_id: string;
  service_name: string;
  starts_at: Date;
  ends_at: Date;
  party_size: number;
  customer_name: string;
  status: BookingStatus;
  customer_cancelled_at: Date | null;
}

const MANAGED_COLUMNS: string[] = [
  'id', 'reference', 'service_id', 'service_name', 'starts_at', 'ends_at', 'party_size',
  'customer_name', 'status', 'customer_cancelled_at',
];

function managed(row: ManagedRow): ManagedBooking {
  return {
    id: row.id, reference: row.reference, serviceId: row.service_id, serviceName: row.service_name,
    startsAt: row.starts_at, endsAt: row.ends_at, partySize: row.party_size,
    customerName: row.customer_name, status: row.status, customerCancelledAt: row.customer_cancelled_at,
  };
}

function tokenBytes(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function validCustomerToken(token: string): boolean {
  return TOKEN.test(token);
}

export async function customerTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function beginCustomerSession(
  env: DatabaseEnv,
  businessId: string,
  reference: string,
  phoneInput: string,
  now: Date,
): Promise<{ token: string } | null> {
  const phone = normalizeMyPhone(phoneInput);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(reference) || !phone) return null;
  const token = tokenBytes();
  const hash = await customerTokenHash(token);
  const found = await withTenant(env, businessId, async (tx) => {
    await tx`delete from booking_customer_session where business_id = ${businessId} and expires_at <= ${now}`;
    const [row] = await tx<{ id: string }[]>`
      select id from booking where business_id = ${businessId}
       and reference = ${reference} and customer_phone = ${phone} limit 1`;
    if (!row) return false;
    await tx`insert into booking_customer_session (business_id, token_hash, booking_id, expires_at, created_at)
      values (${businessId}, ${hash}, ${row.id}, ${new Date(now.getTime() + SESSION_MS)}, ${now})`;
    return true;
  });
  return found ? { token } : null;
}

export async function loadManagedBooking(
  env: DatabaseEnv,
  businessId: string,
  token: string,
  now: Date,
): Promise<ManagedBooking | null> {
  if (!validCustomerToken(token)) return null;
  const hash = await customerTokenHash(token);
  return withTenant(env, businessId, async (tx) => {
    const [row] = await tx<ManagedRow[]>`
      select ${tx(MANAGED_COLUMNS)} from booking b
       join booking_customer_session s on s.business_id = b.business_id and s.booking_id = b.id
       where s.business_id = ${businessId} and s.token_hash = ${hash} and s.expires_at > ${now}`;
    return row ? managed(row) : null;
  });
}

async function lockManaged(
  tx: postgres.TransactionSql,
  businessId: string,
  hash: string,
  now: Date,
): Promise<(ManagedRow & { calendar_status: CalendarStatus }) | null> {
  const [installed] = await tx`select 1 from app_installation
    where business_id = ${businessId} and app_key = 'bookings' for update`;
  if (!installed) return null;
  const [session] = await tx<{ booking_id: string }[]>`select booking_id from booking_customer_session
    where business_id = ${businessId} and token_hash = ${hash} and expires_at > ${now} for update`;
  if (!session) return null;
  const [target] = await tx<{ service_id: string }[]>`select service_id from booking
    where business_id = ${businessId} and id = ${session.booking_id}`;
  if (!target) return null;
  await tx`select 1 from booking_service where business_id = ${businessId} and id = ${target.service_id} for update`;
  const [row] = await tx<Array<ManagedRow & { calendar_status: CalendarStatus }>>`
    select ${tx(MANAGED_COLUMNS)}, calendar_status from booking
     where business_id = ${businessId} and id = ${session.booking_id} for update`;
  return row ?? null;
}

async function notifyOwners(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
  title: string,
  body: string,
  sourceKey: string,
) {
  for (const owner of await ownersOf(tx, businessId)) {
    await createNotification(tx, businessId, {
      recipientUserId: owner, kind: 'booking_requested', title, body, sourceKey,
      url: `/app?view=apps&app=bookings&booking=${bookingId}`,
    });
  }
}

function activity(lang: Lang, kind: 'cancelled' | 'rescheduled', name: string, when: string, service: string, party: number) {
  if (lang === 'bm') return kind === 'cancelled'
    ? { title: 'Tempahan dibatalkan oleh pelanggan', body: `${name} · ${when} · ${service} (${party})` }
    : { title: 'Permintaan penjadualan semula', body: `${name} · ${when} · ${service} (${party})` };
  return kind === 'cancelled'
    ? { title: 'Booking cancelled by customer', body: `${name} · ${when} · ${service} (${party})` }
    : { title: 'Reschedule request', body: `${name} · ${when} · ${service} (${party})` };
}

export type CustomerChangeResult =
  | { kind: 'changed'; booking: ManagedBooking; calendarBookingId: string | null }
  | { kind: 'same'; booking: ManagedBooking }
  | { kind: 'not_found' | 'not_changeable' | 'unavailable' | 'taken' };

export async function cancelByCustomer(
  env: DatabaseEnv,
  businessId: string,
  token: string,
  now: Date,
): Promise<CustomerChangeResult> {
  if (!validCustomerToken(token)) return { kind: 'not_found' };
  const hash = await customerTokenHash(token);
  return withTenant(env, businessId, async (tx): Promise<CustomerChangeResult> => {
    const row = await lockManaged(tx, businessId, hash, now);
    if (!row) return { kind: 'not_found' };
    if (row.status === 'cancelled' && row.customer_cancelled_at) return { kind: 'same', booking: managed(row) };
    if ((row.status !== 'pending' && row.status !== 'confirmed') || row.starts_at.getTime() <= now.getTime()) {
      return { kind: 'not_changeable' };
    }
    const [job] = row.status === 'confirmed'
      ? await tx`select 1 from booking_calendar_job where business_id = ${businessId} and booking_id = ${row.id}`
      : [];
    const eventMayExist = row.status === 'confirmed' && (Boolean(job) || row.calendar_status === 'created');
    const [updated] = await tx<Array<ManagedRow & { calendar_status: CalendarStatus }>>`update booking
      set status = 'cancelled', cancelled_at = ${now}, cancelled_by = null, customer_cancelled_at = ${now},
          calendar_status = ${eventMayExist ? 'pending' : row.calendar_status},
          calendar_error = case when ${eventMayExist} then null else calendar_error end,
          calendar_reason = case when ${eventMayExist} then null else calendar_reason end
      where business_id = ${businessId} and id = ${row.id} and status in ('pending', 'confirmed')
      returning ${tx(MANAGED_COLUMNS)}, calendar_status`;
    if (eventMayExist) await queueCalendarJob(tx, businessId, row.id, 'absent', now);
    const [business] = await tx<{ lang: Lang }[]>`select lang from business where id = ${businessId}`;
    const lang: Lang = business?.lang === 'bm' ? 'bm' : 'en';
    const note = activity(lang, 'cancelled', row.customer_name, whenText(row.starts_at, lang), row.service_name, row.party_size);
    await notifyOwners(tx, businessId, row.id, note.title, note.body, `booking-customer-cancelled:${row.id}`);
    return { kind: 'changed', booking: managed(updated), calendarBookingId: eventMayExist ? row.id : null };
  });
}

async function digestReschedule(id: string, start: Date, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`customer-reschedule:${id}:${start.toISOString()}:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function rescheduleByCustomer(
  env: DatabaseEnv,
  businessId: string,
  token: string,
  startsAt: Date,
  now: Date,
): Promise<CustomerChangeResult> {
  if (!validCustomerToken(token)) return { kind: 'not_found' };
  if (Number.isNaN(startsAt.getTime())) return { kind: 'taken' };
  const hash = await customerTokenHash(token);
  return withTenant(env, businessId, async (tx): Promise<CustomerChangeResult> => {
    const row = await lockManaged(tx, businessId, hash, now);
    if (!row) return { kind: 'not_found' };
    if (row.starts_at.getTime() === startsAt.getTime() && (row.status === 'pending' || row.status === 'confirmed')) {
      return { kind: 'same', booking: managed(row) };
    }
    if ((row.status !== 'pending' && row.status !== 'confirmed') || row.starts_at.getTime() <= now.getTime()) {
      return { kind: 'not_changeable' };
    }
    const [settings] = await tx<{ accepting: boolean; min_notice_minutes: number; horizon_days: number }[]>`
      select accepting, min_notice_minutes, horizon_days from booking_settings where business_id = ${businessId}`;
    const [installation] = await tx<{ state: 'active' | 'paused' }[]>`select state from app_installation
      where business_id = ${businessId} and app_key = 'bookings'`;
    if (!settings?.accepting || installation?.state !== 'active') return { kind: 'unavailable' };
    const [service] = await tx<{ id: string; name: string; duration_minutes: number; capacity: number; active: boolean }[]>`
      select id, name, duration_minutes, capacity, active from booking_service
       where business_id = ${businessId} and id = ${row.service_id}`;
    if (!service?.active) return { kind: 'unavailable' };
    const date = myDate(startsAt);
    const hours = await readHours(tx, businessId, service.id);
    const reservations = await reservationsFor(
      tx, businessId, service.id, myInstant(date), myInstant(addDays(date, 1)), row.id,
    );
    const slot = openSlots({
      service: { durationMinutes: service.duration_minutes, capacity: service.capacity }, hours,
      settings: { minNoticeMinutes: settings.min_notice_minutes, horizonDays: settings.horizon_days },
      reservations, now, from: date, days: 1,
    }).find((candidate) => candidate.startsAt.getTime() === startsAt.getTime());
    if (!slot || slot.remaining < row.party_size) return { kind: 'taken' };

    const submissionKey = crypto.randomUUID();
    const digest = await digestReschedule(row.id, startsAt, submissionKey);
    let created: ManagedRow | null = null;
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      const reference = newReference();
      const [inserted] = await tx<ManagedRow[]>`insert into booking
        (business_id, reference, submission_key, submission_hash, service_id, service_name, starts_at, ends_at,
         party_size, customer_name, customer_phone, note, rescheduled_from_id, created_at)
        select business_id, ${reference}, ${submissionKey}, ${digest}, service_id, ${service.name}, ${slot.startsAt}, ${slot.endsAt},
               party_size, customer_name, customer_phone, note, id, ${now}
          from booking where business_id = ${businessId} and id = ${row.id}
        on conflict (business_id, reference) do nothing returning ${tx(MANAGED_COLUMNS)}`;
      if (inserted) { created = inserted; break; }
    }
    if (!created) throw new Error('could not allocate a rescheduled booking reference');

    const [job] = row.status === 'confirmed'
      ? await tx`select 1 from booking_calendar_job where business_id = ${businessId} and booking_id = ${row.id}`
      : [];
    const eventMayExist = row.status === 'confirmed' && (Boolean(job) || row.calendar_status === 'created');
    await tx`update booking set status = 'cancelled', cancelled_at = ${now}, cancelled_by = null,
        customer_cancelled_at = ${now}, rescheduled_to_id = ${created.id},
        calendar_status = ${eventMayExist ? 'pending' : row.calendar_status},
        calendar_error = case when ${eventMayExist} then null else calendar_error end,
        calendar_reason = case when ${eventMayExist} then null else calendar_reason end
      where business_id = ${businessId} and id = ${row.id}`;
    await tx`update booking_customer_session set booking_id = ${created.id}
      where business_id = ${businessId} and token_hash = ${hash}`;
    if (eventMayExist) await queueCalendarJob(tx, businessId, row.id, 'absent', now);

    const [business] = await tx<{ lang: Lang }[]>`select lang from business where id = ${businessId}`;
    const lang: Lang = business?.lang === 'bm' ? 'bm' : 'en';
    const note = activity(lang, 'rescheduled', row.customer_name, whenText(slot.startsAt, lang), service.name, row.party_size);
    await notifyOwners(tx, businessId, created.id, note.title, note.body, `booking-rescheduled:${created.id}`);
    return { kind: 'changed', booking: managed(created), calendarBookingId: eventMayExist ? row.id : null };
  });
}
