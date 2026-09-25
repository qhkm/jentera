import type postgres from 'postgres';
import { findConnection } from '../../connections';
import { GOOGLE_CALENDAR_CONNECTOR } from '../../connectors/google-calendar';
import { CALENDAR_MAX_ATTEMPTS, calendarPin, sameAccountConnection, type CalendarReason } from './calendar-sync';
import { bookingMessage, bookingReminderMessage, whatsappUrl, type Lang, type MessageKind } from './messages';
import { addDays, myInstant } from './time';
import { queueCalendarJob } from './calendar-job';
import { cancelBookingReminders, scheduleBookingReminders } from './reminders';
import { hasAvailabilityConflict } from './availability';

/* The owner's side of booking requests. Decisions and cancellations lock in
   the common order (the installation, then the service, then the booking)
   and change state with a conditional update, so a double tap or two devices
   deciding at once leave exactly one outcome. */

export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled';
export type CalendarStatus = 'none' | 'pending' | 'created' | 'failed' | 'not_connected' | 'removed';

export interface BookingRow {
  id: string;
  reference: string;
  service_id: string;
  service_name: string;
  starts_at: Date;
  ends_at: Date;
  party_size: number;
  customer_name: string;
  customer_phone: string;
  note: string | null;
  status: BookingStatus;
  decided_at: Date | null;
  cancelled_at: Date | null;
  calendar_status: CalendarStatus;
  calendar_error: string | null;
  calendar_reason: CalendarReason | null;
  calendar_account: string | null;
  calendar_account_label: string | null;
  created_at: Date;
}

export interface BookingContext { businessName: string; lang: Lang; publicUrl: string; now: Date }

export interface BookingJson {
  id: string;
  reference: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  customerName: string;
  customerPhone: string;
  note: string | null;
  status: BookingStatus;
  /** Pending, but its start has passed: it can no longer be confirmed. */
  expired: boolean;
  decidedAt: string | null;
  cancelledAt: string | null;
  calendar: {
    status: CalendarStatus;
    error: string | null;
    /** Why a failed sync failed; null unless status is 'failed'. Branch on this, not on error. */
    reason: CalendarReason | null;
    /** Whether the owner's retry can do anything: a failure other than an event deleted in
        Google (final), or a booking confirmed while nothing was connected. */
    canRetry: boolean;
    /** The Google account (its email) the event lives in, kept across a disconnect. */
    account: string | null;
  };
  /** A prefilled message for the owner to send; never proof it was sent. */
  whatsappUrl: string | null;
  /** A prefilled reminder for the owner to send for a future confirmation. */
  reminderWhatsappUrl: string | null;
  createdAt: string;
}

export interface BookingCursor { d: string; p: 0 | 1; s: string; id: string }

export type DecideResult =
  | { ok: true; row: BookingRow; changed: boolean; calendarQueued: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_DECIDED' | 'EXPIRED' | 'NOT_RETRYABLE' | 'CALENDAR_DISCONNECTED' | 'CALENDAR_CONFLICT' };

// A plain string[]: postgres.js's identifier helper, tx(COLUMNS), does not accept a readonly tuple.
const COLUMNS: string[] = [
  'id', 'reference', 'service_id', 'service_name', 'starts_at', 'ends_at', 'party_size', 'customer_name',
  'customer_phone', 'note', 'status', 'decided_at', 'cancelled_at', 'calendar_status', 'calendar_error',
  'calendar_reason', 'calendar_account', 'calendar_account_label', 'created_at',
];

function messageKind(status: BookingStatus): MessageKind | null {
  return status === 'confirmed' ? 'confirm' : status === 'declined' ? 'decline' : status === 'cancelled' ? 'cancel' : null;
}

export function bookingJson(row: BookingRow, ctx: BookingContext): BookingJson {
  const kind = messageKind(row.status);
  const manageUrl = `${ctx.publicUrl}/manage?ref=${encodeURIComponent(row.reference)}`;
  return {
    id: row.id,
    reference: row.reference,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    partySize: row.party_size,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    note: row.note,
    status: row.status,
    expired: row.status === 'pending' && row.starts_at.getTime() <= ctx.now.getTime(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    calendar: {
      status: row.calendar_status,
      error: row.calendar_error,
      reason: row.calendar_reason,
      canRetry: (row.calendar_status === 'failed' && row.calendar_reason !== 'removed_in_google'
          && !(row.calendar_reason === 'disconnected' && row.calendar_account === null))
        || (row.calendar_status === 'not_connected' && row.status === 'confirmed'),
      account: row.calendar_account_label,
    },
    whatsappUrl: kind ? whatsappUrl(row.customer_phone, bookingMessage({
      kind, lang: ctx.lang, customerName: row.customer_name, serviceName: row.service_name,
      partySize: row.party_size, startsAt: row.starts_at, reference: row.reference,
      businessName: ctx.businessName, publicUrl: ctx.publicUrl,
      manageUrl,
    })) : null,
    reminderWhatsappUrl: row.status === 'confirmed' && row.starts_at.getTime() > ctx.now.getTime()
      ? whatsappUrl(row.customer_phone, bookingReminderMessage({
        lang: ctx.lang, customerName: row.customer_name, serviceName: row.service_name,
        partySize: row.party_size, startsAt: row.starts_at, reference: row.reference,
        businessName: ctx.businessName, publicUrl: ctx.publicUrl, manageUrl,
      })) : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function encodeCursor(cursor: BookingCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(value: string): BookingCursor | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as Record<string, unknown>;
    const ok = typeof raw.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.d) && (raw.p === 0 || raw.p === 1) &&
      typeof raw.s === 'string' && !Number.isNaN(Date.parse(raw.s)) &&
      typeof raw.id === 'string' && /^[0-9a-f-]{36}$/i.test(raw.id);
    return ok ? { d: raw.d as string, p: raw.p as 0 | 1, s: raw.s as string, id: raw.id as string } : null;
  } catch {
    return null;
  }
}

/** Bookings overlapping a window of Malaysian days, ordered by Malaysian
    date, pending first within a day, then start time. */
export async function listBookings(
  tx: postgres.TransactionSql,
  businessId: string,
  query: { from: string; days: number; status: 'pending' | null; cursor: BookingCursor | null; limit?: number; now: Date },
): Promise<{ rows: BookingRow[]; nextCursor: string | null }> {
  const limit = query.limit ?? 50;
  const windowStart = myInstant(query.from);
  const windowEnd = myInstant(addDays(query.from, query.days));
  const day = tx`(starts_at at time zone 'Asia/Kuala_Lumpur')::date`;
  const rows = await tx<Array<BookingRow & { day: string }>>`
    select ${tx(COLUMNS)}, ${day}::text as day from booking
     where business_id = ${businessId} and starts_at < ${windowEnd} and ends_at > ${windowStart}
       ${query.status === 'pending' ? tx`and status = 'pending' and starts_at > ${query.now}` : tx``}
       ${query.cursor ? tx`and (${day}, (status <> 'pending')::int, starts_at, id)
         > (${query.cursor.d}::date, ${query.cursor.p}::int, ${query.cursor.s}::timestamptz, ${query.cursor.id}::uuid)` : tx``}
     order by ${day}, (status <> 'pending')::int, starts_at, id
     limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(({ day: _day, ...row }) => row),
    nextCursor: rows.length > limit && last
      ? encodeCursor({ d: last.day, p: last.status === 'pending' ? 0 : 1, s: last.starts_at.toISOString(), id: last.id })
      : null,
  };
}

export async function getBooking(tx: postgres.TransactionSql, businessId: string, id: string): Promise<BookingRow | null> {
  const [row] = await tx<BookingRow[]>`select ${tx(COLUMNS)} from booking where business_id = ${businessId} and id = ${id}`;
  return row ?? null;
}

/** Lock the installation, the booking's service, then the booking. */
async function lockForChange(tx: postgres.TransactionSql, businessId: string, id: string): Promise<BookingRow | null> {
  const [installed] = await tx`select 1 from app_installation
    where business_id = ${businessId} and app_key = 'bookings' for update`;
  if (!installed) return null;
  const [target] = await tx<{ service_id: string }[]>`select service_id from booking
    where business_id = ${businessId} and id = ${id}`;
  if (!target) return null;
  await tx`select 1 from booking_service where business_id = ${businessId} and id = ${target.service_id} for update`;
  const [row] = await tx<BookingRow[]>`select ${tx(COLUMNS)} from booking
    where business_id = ${businessId} and id = ${id} for update`;
  return row ?? null;
}

export async function decideBooking(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  decision: 'confirm' | 'decline',
  userId: string,
  now: Date,
): Promise<DecideResult> {
  const row = await lockForChange(tx, businessId, id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  const target: BookingStatus = decision === 'confirm' ? 'confirmed' : 'declined';
  if (row.status === target) return { ok: true, row, changed: false, calendarQueued: false };
  if (row.status !== 'pending') return { ok: false, code: 'ALREADY_DECIDED' };
  if (row.starts_at.getTime() <= now.getTime()) return { ok: false, code: 'EXPIRED' };
  if (target === 'confirmed' && await hasAvailabilityConflict(tx, businessId, row.starts_at, row.ends_at)) {
    return { ok: false, code: 'CALENDAR_CONFLICT' };
  }
  let calendarStatus: CalendarStatus = 'none';
  let pin: ReturnType<typeof calendarPin> | null = null;
  if (target === 'confirmed') {
    const connection = await findConnection(tx, GOOGLE_CALENDAR_CONNECTOR);
    pin = connection ? calendarPin(connection) : null;
    calendarStatus = connection ? 'pending' : 'not_connected';
  }
  // The account is recorded beside the connection so that a disconnect, which nulls the
  // connection, still says which Google account the event belongs in.
  const [updated] = await tx<BookingRow[]>`update booking
    set status = ${target}, decided_at = ${now}, decided_by = ${userId},
        calendar_status = ${calendarStatus}, calendar_reason = null, calendar_connection_id = ${pin?.id ?? null},
        calendar_account = ${pin?.account ?? null}, calendar_account_label = ${pin?.label ?? null}
    where business_id = ${businessId} and id = ${id} and status = 'pending'
    returning ${tx(COLUMNS)}`;
  if (pin) await queueCalendarJob(tx, businessId, id, 'present', now);
  if (target === 'confirmed') await scheduleBookingReminders(tx, businessId, id, row.starts_at, now);
  return { ok: true, row: updated, changed: true, calendarQueued: pin !== null };
}

export async function cancelBooking(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  userId: string,
  now: Date,
): Promise<DecideResult> {
  const row = await lockForChange(tx, businessId, id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.status === 'cancelled') return { ok: true, row, changed: false, calendarQueued: false };
  if (row.status !== 'confirmed') return { ok: false, code: 'ALREADY_DECIDED' };
  if (row.starts_at.getTime() <= now.getTime()) return { ok: false, code: 'EXPIRED' };
  const [job] = await tx`select 1 from booking_calendar_job where business_id = ${businessId} and booking_id = ${id}`;
  // An event may exist if one was ever queued or recorded; only then clean up.
  const eventMayExist = Boolean(job) || row.calendar_status === 'created';
  const [updated] = await tx<BookingRow[]>`update booking
    set status = 'cancelled', cancelled_at = ${now}, cancelled_by = ${userId},
        calendar_status = ${eventMayExist ? 'pending' : row.calendar_status},
        calendar_error = ${eventMayExist ? null : row.calendar_error},
        calendar_reason = ${eventMayExist ? null : row.calendar_reason}
    where business_id = ${businessId} and id = ${id} and status = 'confirmed'
    returning ${tx(COLUMNS)}`;
  if (eventMayExist) await queueCalendarJob(tx, businessId, id, 'absent', now);
  await cancelBookingReminders(tx, businessId, id, now);
  return { ok: true, row: updated, changed: true, calendarQueued: eventMayExist };
}

/** The owner's retry: queue the Calendar state the booking should be in
    again, but only when nothing is already on its way. A queued or in-flight
    job keeps its backoff; a finished one is left alone. */
export async function retryCalendar(
  tx: postgres.TransactionSql,
  businessId: string,
  id: string,
  now: Date,
): Promise<DecideResult> {
  const row = await lockForChange(tx, businessId, id);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.status !== 'confirmed' && row.status !== 'cancelled') return { ok: false, code: 'NOT_RETRYABLE' };
  const desired = row.status === 'confirmed' ? 'present' : 'absent';
  const unchanged: DecideResult = { ok: true, row, changed: false, calendarQueued: false };
  const [job] = await tx<{ revision: number; completed_revision: number | null; attempts: number; lease_expires_at: Date | null }[]>`
    select revision, completed_revision, attempts, lease_expires_at from booking_calendar_job
     where business_id = ${businessId} and booking_id = ${id} for update`;
  // A live lease means an attempt is out at Google right now; claim() already
  // counted it against attempts, so it can look maxed out while still
  // running. Never re-queue under it — that would discard its real result as
  // stale. An expired lease is an orphan and falls through like any other.
  if (job?.lease_expires_at && job.lease_expires_at.getTime() > now.getTime()) return unchanged;
  if (job && job.completed_revision !== job.revision && job.attempts < CALENDAR_MAX_ATTEMPTS) return unchanged;
  if (job && job.completed_revision === job.revision && row.calendar_status !== 'failed') return unchanged;
  const [pinned] = await tx<{ calendar_connection_id: string | null; calendar_account: string | null; calendar_account_label: string | null }[]>`
    select calendar_connection_id, calendar_account, calendar_account_label from booking
     where business_id = ${businessId} and id = ${id}`;
  let pin = {
    id: pinned.calendar_connection_id, account: pinned.calendar_account, label: pinned.calendar_account_label,
  };
  if (!job) {
    // No job means no event could exist: a cancel has nothing to clean, and
    // only a booking confirmed while nothing was connected can be added now.
    if (desired === 'absent' || row.calendar_status !== 'not_connected') return unchanged;
    const connection = await findConnection(tx, GOOGLE_CALENDAR_CONNECTOR);
    if (!connection) return unchanged;
    pin = calendarPin(connection);
  } else if (!pin.id) {
    // The connection this booking used is gone. Only the same Google account,
    // connected again, may take it over; never switch to another one.
    const same = pin.account ? await sameAccountConnection(tx, pin.account) : null;
    if (!same) return { ok: false, code: 'CALENDAR_DISCONNECTED' };
    const repinned = calendarPin(same);
    pin = { id: repinned.id, account: pin.account, label: repinned.label ?? pin.label };
  }
  const [updated] = await tx<BookingRow[]>`update booking
    set calendar_status = 'pending', calendar_error = null, calendar_reason = null,
        calendar_connection_id = ${pin.id}, calendar_account = ${pin.account}, calendar_account_label = ${pin.label}
    where business_id = ${businessId} and id = ${id}
    returning ${tx(COLUMNS)}`;
  await queueCalendarJob(tx, businessId, id, desired, now);
  return { ok: true, row: updated, changed: true, calendarQueued: true };
}
