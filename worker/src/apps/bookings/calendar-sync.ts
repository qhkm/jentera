import type postgres from 'postgres';
import type { Env } from '../../env';
import { withTenant } from '../../db';
import {
  findConnectionById,
  markConnectionExpired,
  markConnectionHealthy,
  markConnectionProblem,
  useCredential,
} from '../../connections';
import {
  GOOGLE_CALENDAR_CONNECTOR,
  GoogleCalendarError,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  normaliseCalendarEvent,
  type CalendarEventInput,
} from '../../connectors/google-calendar';
import { appsEnabledFor } from '../gating';
import { MY_TIME_ZONE, myIso } from './time';

/* A booking's Google Calendar event, kept in step with the booking.

   The owner's confirm or cancel commits a booking_calendar_job row in the
   same transaction as the decision. This module is the only thing that acts
   on it. The first attempt runs right after the decision commits
   (ctx.waitUntil in the placed HTTP invocation); the minute cron picks up
   retries and anything a crash left behind. Both go through
   processBookingCalendarJob, so both claim the same lease and check the
   same revision.

   Each attempt has three steps, and Google is only called between
   transactions:
     1. claim    - lock the installation, the booking and the job (the
                   common lock order, never the job first); take a lease;
                   count the attempt; read the credential.
     2. Google   - create or delete the event's deterministic id, within a
                   budget that covers the token refresh too.
     3. complete - lock again in the same order; write the result only if
                   the lease is still ours and the revision has not moved.
                   A cancel that landed during step 2 bumps the revision,
                   so a late "created" is never recorded over it. */

export const CALENDAR_MAX_ATTEMPTS = 8;
export const CALENDAR_BUDGET_MS = 8_000;
const LEASE_MS = 120_000;
const DISABLED_DEFER_MS = 60 * 60_000;

export const CALENDAR_RECONNECT = 'Reconnect Google Calendar, then retry.';
export const CALENDAR_REMOVED_IN_GOOGLE =
  'This event was deleted in Google Calendar, so Jentera did not add it again.';
export const CALENDAR_DISCONNECTED_CLEANUP =
  'Google Calendar was disconnected, so this event could not be removed. Delete it in Google Calendar.';

/** What one call did. The first four ran an attempt; the rest recorded nothing about Google. */
export type CalendarOutcome = 'created' | 'removed' | 'retrying' | 'failed' | 'stale' | 'busy' | 'idle' | 'deferred';

export interface CalendarDeps {
  fetch?: typeof fetch;
  now?: () => Date;
  budgetMs?: number;
}

interface SyncBooking {
  id: string;
  reference: string;
  service_name: string;
  starts_at: Date;
  ends_at: Date;
  party_size: number;
  customer_name: string;
  customer_phone: string;
  note: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
  calendar_connection_id: string | null;
}

interface SyncJob {
  desired: 'present' | 'absent';
  revision: number;
  completed_revision: number | null;
  attempts: number;
  next_attempt_at: Date;
  lease_token: string | null;
  lease_expires_at: Date | null;
}

interface Claim {
  token: string;
  revision: number;
  desired: 'present' | 'absent';
  attempts: number;
  connectionId: string;
  secret: string;
  booking: SyncBooking;
}

type ProviderResult =
  | { kind: 'created'; eventId: string }
  | { kind: 'removed' }
  | { kind: 'removed_in_google' }
  | { kind: 'error'; auth: boolean; message: string };

/** 1, 2, 4 … minutes, capped at an hour: the push outbox's schedule. */
function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** (attempts - 1)) * 60_000;
}

function errorLabel(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} ${code}` : name;
}

/** The common lock order: the installation, then the booking, then the job. */
async function lockJob(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
): Promise<{ booking: SyncBooking; job: SyncJob } | null> {
  const [installed] = await tx`select 1 from app_installation
    where business_id = ${businessId} and app_key = 'bookings' for update`;
  if (!installed) return null;
  const [booking] = await tx<SyncBooking[]>`
    select id, reference, service_name, starts_at, ends_at, party_size, customer_name, customer_phone, note,
           status, calendar_connection_id
      from booking where business_id = ${businessId} and id = ${bookingId} for update`;
  if (!booking) return null;
  const [job] = await tx<SyncJob[]>`
    select desired, revision, completed_revision, attempts, next_attempt_at, lease_token, lease_expires_at
      from booking_calendar_job where business_id = ${businessId} and booking_id = ${bookingId} for update`;
  return job ? { booking, job } : null;
}

/** Stop retrying and tell the owner why. The owner's retry starts it again. */
async function giveUp(
  tx: postgres.TransactionSql,
  businessId: string,
  bookingId: string,
  why: string,
  now: Date,
): Promise<void> {
  const message = why.slice(0, 300);
  await tx`update booking_calendar_job
    set attempts = ${CALENDAR_MAX_ATTEMPTS}, lease_token = null, lease_expires_at = null,
        last_error = ${message}, updated_at = ${now}
    where business_id = ${businessId} and booking_id = ${bookingId}`;
  await tx`update booking set calendar_status = 'failed', calendar_error = ${message}
    where business_id = ${businessId} and id = ${bookingId}`;
}

async function claim(
  env: Env,
  businessId: string,
  bookingId: string,
  now: Date,
): Promise<{ kind: 'claimed'; claim: Claim } | { kind: 'done'; outcome: CalendarOutcome }> {
  return withTenant(env, businessId, async (tx) => {
    const locked = await lockJob(tx, businessId, bookingId);
    if (!locked) return { kind: 'done', outcome: 'idle' };
    const { booking, job } = locked;
    if (job.completed_revision === job.revision || job.attempts >= CALENDAR_MAX_ATTEMPTS) {
      return { kind: 'done', outcome: 'idle' };
    }
    if (job.lease_expires_at && job.lease_expires_at.getTime() > now.getTime()) return { kind: 'done', outcome: 'busy' };
    if (job.next_attempt_at.getTime() > now.getTime()) return { kind: 'done', outcome: 'idle' };
    if (!appsEnabledFor(env, businessId)) {
      // Kept for when the pilot comes back, and moved out of the due scan's way meanwhile.
      await tx`update booking_calendar_job
        set next_attempt_at = ${new Date(now.getTime() + DISABLED_DEFER_MS)}, updated_at = ${now}
        where business_id = ${businessId} and booking_id = ${bookingId}`;
      return { kind: 'done', outcome: 'deferred' };
    }
    if (booking.status !== (job.desired === 'present' ? 'confirmed' : 'cancelled')) {
      // Only a confirmed booking has an event to add and only a cancelled one has one to remove.
      await tx`update booking_calendar_job
        set completed_revision = revision, lease_token = null, lease_expires_at = null, updated_at = ${now}
        where business_id = ${businessId} and booking_id = ${bookingId}`;
      return { kind: 'done', outcome: 'idle' };
    }
    const connection = booking.calendar_connection_id
      ? await findConnectionById(tx, booking.calendar_connection_id)
      : null;
    if (!connection || connection.connector !== GOOGLE_CALENDAR_CONNECTOR) {
      // Never pick another connection: that could create or delete in a different account.
      await giveUp(tx, businessId, bookingId, job.desired === 'absent' ? CALENDAR_DISCONNECTED_CLEANUP : CALENDAR_RECONNECT, now);
      return { kind: 'done', outcome: 'failed' };
    }
    if (connection.status !== 'connected') {
      await giveUp(tx, businessId, bookingId, CALENDAR_RECONNECT, now);
      return { kind: 'done', outcome: 'failed' };
    }
    let secret: string;
    try {
      secret = await useCredential(env, tx, connection.id);
    } catch {
      await giveUp(tx, businessId, bookingId, CALENDAR_RECONNECT, now);
      return { kind: 'done', outcome: 'failed' };
    }
    const token = crypto.randomUUID();
    await tx`update booking_calendar_job
      set lease_token = ${token}, lease_expires_at = ${new Date(now.getTime() + LEASE_MS)},
          attempts = attempts + 1, updated_at = ${now}
      where business_id = ${businessId} and booking_id = ${bookingId}`;
    return {
      kind: 'claimed',
      claim: {
        token, revision: job.revision, desired: job.desired, attempts: job.attempts + 1,
        connectionId: connection.id, secret, booking,
      },
    };
  });
}

/** What the owner sees in Google: the service, who, and how many; the
    reference, phone and note in the description. */
function bookingEvent(booking: SyncBooking): CalendarEventInput {
  const lines = [`Ref ${booking.reference}`, `Phone +${booking.customer_phone}`];
  if (booking.note) lines.push(`Note: ${booking.note}`);
  return normaliseCalendarEvent({
    requestId: booking.id,
    summary: `${booking.service_name} · ${booking.customer_name} (${booking.party_size})`,
    start: myIso(booking.starts_at),
    end: myIso(booking.ends_at),
    timeZone: MY_TIME_ZONE,
    description: lines.join('\n'),
  });
}

async function callGoogle(env: Env, work: Claim, deps: CalendarDeps): Promise<ProviderResult> {
  const signal = AbortSignal.timeout(deps.budgetMs ?? CALENDAR_BUDGET_MS);
  const fetcher = deps.fetch ?? fetch;
  try {
    if (work.desired === 'present') {
      const event = await createGoogleCalendarEvent(env, work.secret, bookingEvent(work.booking), fetcher, signal);
      // A 409 read-back of a deleted event: the owner removed it in Google. Not a live event.
      return event.status === 'cancelled' ? { kind: 'removed_in_google' } : { kind: 'created', eventId: event.id };
    }
    await deleteGoogleCalendarEvent(env, work.secret, work.booking.id, fetcher, signal);
    return { kind: 'removed' };
  } catch (error) {
    if (error instanceof GoogleCalendarError) return { kind: 'error', auth: error.auth, message: error.message };
    return {
      kind: 'error',
      auth: false,
      message: signal.aborted ? 'Google Calendar did not answer in time.' : 'Google Calendar could not be reached.',
    };
  }
}

async function complete(
  env: Env,
  businessId: string,
  bookingId: string,
  work: Claim,
  result: ProviderResult,
  now: Date,
): Promise<CalendarOutcome> {
  return withTenant(env, businessId, async (tx) => {
    const locked = await lockJob(tx, businessId, bookingId);
    if (!locked) return 'stale';
    const { job } = locked;
    const ours = job.lease_token === work.token;
    if (!ours || job.revision !== work.revision) {
      /* Someone else owns the job now, or the booking wants something else
         (a cancel during a create). Record nothing; if the lease is still
         ours, release it and leave the new revision due at once. */
      if (ours) {
        await tx`update booking_calendar_job
          set lease_token = null, lease_expires_at = null, next_attempt_at = ${now}, updated_at = ${now}
          where business_id = ${businessId} and booking_id = ${bookingId}`;
      }
      return 'stale';
    }
    const done = async (lastError: string | null) => {
      await tx`update booking_calendar_job
        set completed_revision = revision, lease_token = null, lease_expires_at = null,
            last_error = ${lastError}, updated_at = ${now}
        where business_id = ${businessId} and booking_id = ${bookingId}`;
    };
    switch (result.kind) {
      case 'created':
        await done(null);
        await tx`update booking set calendar_status = 'created', calendar_event_id = ${result.eventId}, calendar_error = null
          where business_id = ${businessId} and id = ${bookingId}`;
        await markConnectionHealthy(tx, work.connectionId);
        return 'created';
      case 'removed':
        await done(null);
        await tx`update booking set calendar_status = 'removed', calendar_error = null
          where business_id = ${businessId} and id = ${bookingId}`;
        await markConnectionHealthy(tx, work.connectionId);
        return 'removed';
      case 'removed_in_google':
        // Final: the same id cannot come back, and a new id would be a second event.
        await done(CALENDAR_REMOVED_IN_GOOGLE);
        await tx`update booking set calendar_status = 'failed', calendar_error = ${CALENDAR_REMOVED_IN_GOOGLE}
          where business_id = ${businessId} and id = ${bookingId}`;
        await markConnectionHealthy(tx, work.connectionId);
        return 'failed';
      case 'error': {
        if (result.auth) {
          await markConnectionExpired(tx, work.connectionId, result.message);
          await giveUp(tx, businessId, bookingId, result.message, now);
          return 'failed';
        }
        await markConnectionProblem(tx, work.connectionId, result.message);
        if (work.attempts >= CALENDAR_MAX_ATTEMPTS) {
          await giveUp(tx, businessId, bookingId, result.message, now);
          return 'failed';
        }
        await tx`update booking_calendar_job
          set lease_token = null, lease_expires_at = null, last_error = ${result.message.slice(0, 300)},
              next_attempt_at = ${new Date(now.getTime() + retryDelayMs(work.attempts))}, updated_at = ${now}
          where business_id = ${businessId} and booking_id = ${bookingId}`;
        return 'retrying';
      }
    }
  });
}

/** One attempt at the booking's Calendar job. Safe to call from anywhere, any
    number of times: the lease, the revision and the backoff decide whether it
    does anything. May throw on a database error; callers that must not throw
    use runCalendarJob. */
export async function processBookingCalendarJob(
  env: Env,
  businessId: string,
  bookingId: string,
  deps: CalendarDeps = {},
): Promise<CalendarOutcome> {
  const now = () => deps.now?.() ?? new Date();
  const claimed = await claim(env, businessId, bookingId, now());
  if (claimed.kind === 'done') return claimed.outcome;
  const result = await callGoogle(env, claimed.claim, deps);
  return complete(env, businessId, bookingId, claimed.claim, result, now());
}

/** For ctx.waitUntil: never rejects, and logs ids and the error's name only. */
export async function runCalendarJob(
  env: Env,
  businessId: string,
  bookingId: string,
  deps: CalendarDeps = {},
): Promise<void> {
  try {
    await processBookingCalendarJob(env, businessId, bookingId, deps);
  } catch (error) {
    console.error(`[bookings-calendar] business=${businessId} booking=${bookingId} ${errorLabel(error)}`);
  }
}
