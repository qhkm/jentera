import type postgres from 'postgres';
import type { Env } from '../../env';
import { connect, withTenant } from '../../db';
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
const SWEEP_LIMIT = 10;
/* A job whose processing threw (a rethrown credential fault, a database error) keeps its old
   next_attempt_at, so left alone it would sit at the head of the due scan and be retried every
   sweep — with enough of them, other tenants' due jobs never get a turn. The sweep pushes such a
   job's next_attempt_at forward by this much; see sweepBookingCalendar. */
const SWEEP_ERROR_DEFER_MS = 5 * 60_000;

export const CALENDAR_RECONNECT = 'Reconnect Google Calendar, then retry.';
export const CALENDAR_REMOVED_IN_GOOGLE =
  'This event was deleted in Google Calendar, so Jentera did not add it again.';
export const CALENDAR_DISCONNECTED_CLEANUP =
  'Google Calendar was disconnected, so this event could not be removed. Delete it in Google Calendar.';
export const CALENDAR_UNCONFIRMED =
  'Jentera could not confirm this with Google Calendar. Retry to check again.';

/** What one call did. 'created', 'removed' and 'retrying' always called Google. 'stale' always
    called Google too — it is returned only by complete(), which runs after callGoogle — and
    spent an attempt; it just recorded nothing, because the lease or revision had moved while
    Google was answering. 'failed' may or may not have: claim can give up before ever calling it
    (no usable connection, an expired grant, an orphaned attempt whose executor never returned),
    or complete can record a provider failure after calling it. Only 'busy', 'idle' and 'deferred'
    never call Google. */
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

/** What complete() found out about the connection, decided while it still holds every lock. The
    write itself happens afterwards, in its own short transaction — see processBookingCalendarJob. */
type ConnectionAction = 'healthy' | { problem: string } | { expired: string } | null;

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
    const notCompleted = job.completed_revision !== job.revision;
    if (notCompleted && job.attempts >= CALENDAR_MAX_ATTEMPTS &&
        job.lease_expires_at && job.lease_expires_at.getTime() <= now.getTime()) {
      /* The attempt that reached the limit took a lease and never came back to record anything —
         the isolate died, the database call failed, whatever. Left alone this job would sit
         forever: attempts >= CALENDAR_MAX_ATTEMPTS excludes it from the due scan, and a direct
         call would fall through to the idle return below without telling the owner anything. */
      await giveUp(tx, businessId, bookingId, CALENDAR_UNCONFIRMED, now);
      return { kind: 'done', outcome: 'failed' };
    }
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const name = error instanceof Error ? error.name : '';
      /* Only the credential itself being missing or unreadable is the owner's problem to fix by
         reconnecting. Anything else — a missing CREDENTIAL_KEY version, a truncated ciphertext
         read, a connection error — is ours, and must not be spent as a failed attempt or mistaken
         for a broken grant: rethrow so the transaction rolls back before any lease or attempt is
         taken, and runCalendarJob (or the sweep) logs it. */
      if (message === 'that connection has no credential' || name === 'OperationError') {
        console.warn(`[bookings-calendar] business=${businessId} booking=${bookingId} credential ${errorLabel(error)}`);
        await giveUp(tx, businessId, bookingId, CALENDAR_RECONNECT, now);
        return { kind: 'done', outcome: 'failed' };
      }
      throw error;
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
    // The budget abort is expected and already explained to the owner; anything else is a
    // surprise (a network failure, a parse error) worth a line in the logs to chase later.
    if (!signal.aborted) console.error(`[bookings-calendar] booking=${work.booking.id} google ${errorLabel(error)}`);
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
): Promise<{ outcome: CalendarOutcome; connectionAction: ConnectionAction }> {
  return withTenant(env, businessId, async (tx) => {
    const locked = await lockJob(tx, businessId, bookingId);
    if (!locked) return { outcome: 'stale', connectionAction: null };
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
      return { outcome: 'stale', connectionAction: null };
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
        return { outcome: 'created', connectionAction: 'healthy' };
      case 'removed':
        await done(null);
        await tx`update booking set calendar_status = 'removed', calendar_error = null
          where business_id = ${businessId} and id = ${bookingId}`;
        return { outcome: 'removed', connectionAction: 'healthy' };
      case 'removed_in_google':
        // Final: the same id cannot come back, and a new id would be a second event.
        await done(CALENDAR_REMOVED_IN_GOOGLE);
        await tx`update booking set calendar_status = 'failed', calendar_error = ${CALENDAR_REMOVED_IN_GOOGLE}
          where business_id = ${businessId} and id = ${bookingId}`;
        return { outcome: 'failed', connectionAction: 'healthy' };
      case 'error': {
        // The connection write happens after this transaction commits — see
        // processBookingCalendarJob — so it never competes for the booking/job locks this
        // transaction holds. Only giving up (a job-table write already inside this lock set)
        // stays here.
        if (result.auth) {
          await giveUp(tx, businessId, bookingId, result.message, now);
          return { outcome: 'failed', connectionAction: { expired: result.message } };
        }
        if (work.attempts >= CALENDAR_MAX_ATTEMPTS) {
          await giveUp(tx, businessId, bookingId, result.message, now);
          return { outcome: 'failed', connectionAction: { problem: result.message } };
        }
        await tx`update booking_calendar_job
          set lease_token = null, lease_expires_at = null, last_error = ${result.message.slice(0, 300)},
              next_attempt_at = ${new Date(now.getTime() + retryDelayMs(work.attempts))}, updated_at = ${now}
          where business_id = ${businessId} and booking_id = ${bookingId}`;
        return { outcome: 'retrying', connectionAction: { problem: result.message } };
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
  const { outcome, connectionAction } = await complete(env, businessId, bookingId, claimed.claim, result, now());
  if (connectionAction) await applyConnectionAction(env, businessId, bookingId, claimed.claim.connectionId, connectionAction);
  return outcome;
}

/** The connection write complete() decided on, made after it has released every lock. Best
    effort and isolated: a failure here must not turn a real outcome into an error, and must not
    contend with the next claim for the same rows — so it logs and moves on rather than
    retrying or propagating. */
async function applyConnectionAction(
  env: Env,
  businessId: string,
  bookingId: string,
  connectionId: string,
  action: 'healthy' | { problem: string } | { expired: string },
): Promise<void> {
  try {
    await withTenant(env, businessId, (tx) => {
      if (action === 'healthy') return markConnectionHealthy(tx, connectionId);
      if ('expired' in action) return markConnectionExpired(tx, connectionId, action.expired);
      return markConnectionProblem(tx, connectionId, action.problem);
    });
  } catch (error) {
    console.error(`[bookings-calendar] business=${businessId} booking=${bookingId} connection ${errorLabel(error)}`);
  }
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

export interface CalendarSweepSummary {
  processed: number;
  created: number;
  removed: number;
  retrying: number;
  failed: number;
  errors: number;
}

/** Best effort: push a job that threw out of the due scan's way, without spending an attempt.
    Only when nothing currently holds a live lease on it — a thrown claim rolls its own
    transaction back before ever taking one, so this only ever competes with a lease that expired
    on its own. Its own failure must not turn a real outcome into a second error for the same job,
    so it is logged and swallowed rather than propagated. */
async function deferSweepError(env: Env, businessId: string, bookingId: string, now: Date): Promise<void> {
  try {
    await withTenant(env, businessId, (tx) => tx`update booking_calendar_job
      set next_attempt_at = ${new Date(now.getTime() + SWEEP_ERROR_DEFER_MS)}, updated_at = ${now}
      where business_id = ${businessId} and booking_id = ${bookingId}
        and (lease_token is null or lease_expires_at <= ${now})`);
  } catch (error) {
    console.error(`[bookings-calendar] business=${businessId} booking=${bookingId} defer ${errorLabel(error)}`);
  }
}

/** The minute cron's part: retries, and whatever a crash or a lost
    waitUntil left due. One cross-tenant read of ids through the security
    definer; each job is then claimed inside its own tenant. The batch is
    small because the cron runs far from Neon. */
export async function sweepBookingCalendar(
  env: Env,
  deps: CalendarDeps & { limit?: number } = {},
): Promise<CalendarSweepSummary> {
  const summary: CalendarSweepSummary = { processed: 0, created: 0, removed: 0, retrying: 0, failed: 0, errors: 0 };
  if (env.APPS_ENABLED !== 'true') return summary;
  const now = deps.now?.() ?? new Date();
  const sql = connect(env);
  let due: { business_id: string; booking_id: string }[];
  try {
    due = await sql<{ business_id: string; booking_id: string }[]>`
      select business_id, booking_id
        from public.booking_calendar_due(${now.toISOString()}::timestamptz, ${deps.limit ?? SWEEP_LIMIT})`;
  } finally {
    await sql.end();
  }
  for (const job of due) {
    try {
      const outcome = await processBookingCalendarJob(env, job.business_id, job.booking_id, deps);
      summary.processed += 1;
      if (outcome === 'created' || outcome === 'removed' || outcome === 'retrying' || outcome === 'failed') {
        summary[outcome] += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`[bookings-calendar] business=${job.business_id} booking=${job.booking_id} ${errorLabel(error)}`);
      await deferSweepError(env, job.business_id, job.booking_id, now);
    }
  }
  return summary;
}
