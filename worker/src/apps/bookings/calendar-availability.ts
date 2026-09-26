import { connect, withTenant } from '../../db';
import type { Env } from '../../env';
import {
  findConnection,
  markConnectionExpired,
  markConnectionHealthy,
  markConnectionProblem,
  useCredential,
} from '../../connections';
import {
  GOOGLE_CALENDAR_CONNECTOR,
  GoogleCalendarError,
  listGoogleCalendarBusy,
  type CalendarBusyInterval,
} from '../../connectors/google-calendar';
import { appsEnabledFor } from '../gating';
import { addDays, myDate, myInstant } from './time';

const SUCCESS_DELAY_MS = 5 * 60_000;
const FAILURE_DELAY_MS = 5 * 60_000;
const CLAIM_MS = 2 * 60_000;
const BUDGET_MS = 10_000;
const SWEEP_LIMIT = 5;

export type AvailabilityRefresh = 'synced' | 'not_connected' | 'not_due' | 'error';

interface Claim {
  connectionId: string;
  secret: string;
  from: Date;
  to: Date;
}

async function claim(
  env: Env,
  businessId: string,
  now: Date,
  force: boolean,
): Promise<Claim | AvailabilityRefresh> {
  return withTenant(env, businessId, async (tx) => {
    const connection = await findConnection(tx, GOOGLE_CALENDAR_CONNECTOR);
    if (!connection) return 'not_connected';
    const [settings] = await tx<{ horizon_days: number }[]>`
      select horizon_days from booking_settings where business_id = ${businessId}`;
    if (!settings) return 'not_connected';
    await tx`insert into booking_calendar_availability
      (business_id, connection_id, next_sync_at, updated_at)
      values (${businessId}, ${connection.id}, ${now}, ${now})
      on conflict (business_id) do nothing`;
    const [state] = await tx<{ connection_id: string; next_sync_at: Date }[]>`
      select connection_id, next_sync_at from booking_calendar_availability
       where business_id = ${businessId} for update`;
    if (state.connection_id !== connection.id) {
      await tx`delete from booking_calendar_busy where business_id = ${businessId}`;
      await tx`update booking_calendar_availability
        set connection_id = ${connection.id}, synced_at = null, window_start = null, window_end = null,
            next_sync_at = ${now}, last_error = null, updated_at = ${now}
        where business_id = ${businessId}`;
    } else if (!force && state.next_sync_at.getTime() > now.getTime()) {
      return 'not_due';
    }
    await tx`update booking_calendar_availability
      set next_sync_at = ${new Date(now.getTime() + CLAIM_MS)}, updated_at = ${now}
      where business_id = ${businessId}`;
    let secret: string;
    try {
      secret = await useCredential(env, tx, connection.id);
    } catch {
      const message = 'Google Calendar availability could not be checked.';
      await tx`update booking_calendar_availability
        set next_sync_at = ${new Date(now.getTime() + FAILURE_DELAY_MS)}, last_error = ${message}, updated_at = ${now}
        where business_id = ${businessId}`;
      await markConnectionProblem(tx, connection.id, message);
      return 'error';
    }
    const date = myDate(now);
    return {
      connectionId: connection.id,
      secret,
      from: myInstant(date),
      to: myInstant(addDays(date, settings.horizon_days + 1)),
    };
  });
}

async function saveBusy(
  env: Env,
  businessId: string,
  claimed: Claim,
  busy: CalendarBusyInterval[],
  now: Date,
): Promise<boolean> {
  return withTenant(env, businessId, async (tx) => {
    const current = await findConnection(tx, GOOGLE_CALENDAR_CONNECTOR);
    if (!current || current.id !== claimed.connectionId) return false;
    await tx`delete from booking_calendar_busy where business_id = ${businessId}`;
    if (busy.length > 0) {
      const records = busy.map((range) => ({
        event_key: range.eventKey,
        starts_at: range.startsAt.toISOString(),
        ends_at: range.endsAt.toISOString(),
      }));
      await tx`insert into booking_calendar_busy
        (business_id, connection_id, event_key, starts_at, ends_at, updated_at)
        select ${businessId}, ${claimed.connectionId}, x.event_key, x.starts_at, x.ends_at, ${now}
          from jsonb_to_recordset(${tx.json(records)})
            as x(event_key text, starts_at timestamptz, ends_at timestamptz)`;
    }
    await tx`update booking_calendar_availability
      set synced_at = ${now}, window_start = ${claimed.from}, window_end = ${claimed.to},
          next_sync_at = ${new Date(now.getTime() + SUCCESS_DELAY_MS)}, last_error = null, updated_at = ${now}
      where business_id = ${businessId} and connection_id = ${claimed.connectionId}`;
    await markConnectionHealthy(tx, claimed.connectionId);
    return true;
  });
}

async function recordFailure(
  env: Env,
  businessId: string,
  connectionId: string | null,
  error: unknown,
  now: Date,
): Promise<void> {
  const message = error instanceof GoogleCalendarError ? error.message : 'Google Calendar availability could not be checked.';
  await withTenant(env, businessId, async (tx) => {
    await tx`update booking_calendar_availability
      set next_sync_at = ${new Date(now.getTime() + FAILURE_DELAY_MS)}, last_error = ${message.slice(0, 500)}, updated_at = ${now}
      where business_id = ${businessId}`;
    if (!connectionId) return;
    if (error instanceof GoogleCalendarError && error.auth) await markConnectionExpired(tx, connectionId, message);
    else await markConnectionProblem(tx, connectionId, message);
  });
}

/** Refresh one business without holding a database transaction across Google.
    Existing cache remains intact on failure, so an outage fails toward safety. */
export async function refreshBookingCalendarAvailability(
  env: Env,
  businessId: string,
  options: { now?: Date; force?: boolean; fetch?: typeof fetch } = {},
): Promise<AvailabilityRefresh> {
  const now = options.now ?? new Date();
  let claimed: Claim | null = null;
  try {
    const result = await claim(env, businessId, now, options.force === true);
    if (typeof result === 'string') return result;
    claimed = result;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BUDGET_MS);
    try {
      const busy = await listGoogleCalendarBusy(env, claimed.secret, {
        timeMin: claimed.from.toISOString(), timeMax: claimed.to.toISOString(),
      }, options.fetch, controller.signal);
      return await saveBusy(env, businessId, claimed, busy, now) ? 'synced' : 'not_connected';
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    try { await recordFailure(env, businessId, claimed?.connectionId ?? null, error, now); }
    catch { /* The caller still receives one safe outcome. */ }
    console.error(`[bookings-availability] business=${businessId} ${error instanceof Error ? error.name : 'error'}`);
    return 'error';
  }
}

export interface AvailabilitySweepSummary { synced: number; skipped: number; errors: number }

export async function sweepBookingCalendarAvailability(
  env: Env,
  options: { now?: Date; limit?: number; fetch?: typeof fetch } = {},
): Promise<AvailabilitySweepSummary> {
  const summary = { synced: 0, skipped: 0, errors: 0 };
  if (env.APPS_ENABLED !== 'true') return summary;
  const now = options.now ?? new Date();
  const sql = connect(env);
  let targets: { business_id: string }[];
  try {
    targets = await sql<{ business_id: string }[]>`
      select business_id from public.booking_calendar_availability_due(${now.toISOString()}::timestamptz, ${options.limit ?? SWEEP_LIMIT})`;
  } finally {
    await sql.end();
  }
  for (const target of targets) {
    if (!appsEnabledFor(env, target.business_id)) { summary.skipped += 1; continue; }
    const result = await refreshBookingCalendarAvailability(env, target.business_id, { now, fetch: options.fetch });
    if (result === 'synced') summary.synced += 1;
    else if (result === 'error') summary.errors += 1;
    else summary.skipped += 1;
  }
  return summary;
}
