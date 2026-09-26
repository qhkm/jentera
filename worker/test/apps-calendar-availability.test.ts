import { beforeEach, describe, expect, it } from 'vitest';
import {
  refreshBookingCalendarAvailability,
  sweepBookingCalendarAvailability,
} from '../src/apps/bookings/calendar-availability';
import { saveConnection } from '../src/connections';
import { GOOGLE_CALENDAR_SCOPES, calendarSecret } from '../src/connectors/google-calendar';
import { asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-05T00:00:00Z');
const ENV = testEnv({
  APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A,
  GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
});
let owner = '';
let connectionId = '';

beforeEach(async () => {
  await truncateAll();
  owner = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'Alpha', 'services', true), (${B}, 'Beta', 'salon', true)`;
    const [user] = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('owner@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${user.id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug)
      values (${A}, 'bookings', 'alpha')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, horizon_days)
      values (${A}, ${NOW}, 30)`;
    return user.id;
  });
  const connection = await asTenant(A, (tx) => saveConnection(ENV, tx, A, {
    connector: 'google', method: 'oauth', externalId: 'account-1', displayName: 'owner@example.com',
    secret: calendarSecret({
      subject: 'account-1', email: 'owner@example.com', name: null,
      refreshToken: 'refresh-secret', scopes: [...GOOGLE_CALENDAR_SCOPES],
    }),
    connectedBy: owner, scopes: [...GOOGLE_CALENDAR_SCOPES],
  }));
  connectionId = connection.id;
});

function google(items: unknown[], status = 200) {
  return fetchFake(async (input) => String(input) === 'https://oauth2.googleapis.com/token'
    ? Response.json({ access_token: 'access' })
    : Response.json({ items }, { status })) as unknown as typeof fetch;
}

describe('booking Calendar availability cache', () => {
  it('stores time ranges only and schedules the next refresh', async () => {
    const fetcher = google([{
      id: 'private-provider-id', summary: 'Sensitive meeting title', description: 'Never persist me',
      start: { dateTime: '2026-10-06T10:00:00+08:00' },
      end: { dateTime: '2026-10-06T11:00:00+08:00' },
    }]);
    expect(await refreshBookingCalendarAvailability(ENV, A, { now: NOW, fetch: fetcher })).toBe('synced');
    const snapshot = await asOwner(async (sql) => ({
      busy: await sql`select event_key, starts_at, ends_at from booking_calendar_busy where business_id = ${A}`,
      state: (await sql`select connection_id, synced_at, next_sync_at, last_error
        from booking_calendar_availability where business_id = ${A}`)[0],
    }));
    expect(snapshot.busy).toEqual([expect.objectContaining({ event_key: 'private-provider-id' })]);
    expect(JSON.stringify(snapshot)).not.toContain('Sensitive meeting title');
    expect(JSON.stringify(snapshot)).not.toContain('Never persist me');
    expect(snapshot.state).toMatchObject({ connection_id: connectionId, synced_at: NOW, last_error: null });
    expect(snapshot.state.next_sync_at.toISOString()).toBe('2026-10-05T00:05:00.000Z');
  });

  it('keeps the previous safe cache when Google is unavailable', async () => {
    await asOwner((sql) => sql`insert into booking_calendar_busy
      (business_id, connection_id, event_key, starts_at, ends_at)
      values (${A}, ${connectionId}, 'old-busy', '2026-10-06T02:00:00Z', '2026-10-06T03:00:00Z')`);
    const unavailable = fetchFake(async (input) => String(input) === 'https://oauth2.googleapis.com/token'
      ? Response.json({ access_token: 'access' })
      : new Response('{}', { status: 503 })) as unknown as typeof fetch;
    expect(await refreshBookingCalendarAvailability(ENV, A, { now: NOW, force: true, fetch: unavailable })).toBe('error');
    const [busy] = await asOwner((sql) => sql`select event_key from booking_calendar_busy where business_id = ${A}`);
    const [state] = await asOwner((sql) => sql`select last_error from booking_calendar_availability where business_id = ${A}`);
    expect(busy.event_key).toBe('old-busy');
    expect(state.last_error).toContain('could not complete');
  });

  it('sweeps only due businesses that are in the apps pilot', async () => {
    const fetcher = google([]);
    expect(await sweepBookingCalendarAvailability(ENV, { now: NOW, fetch: fetcher })).toEqual({
      synced: 1, skipped: 0, errors: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await sweepBookingCalendarAvailability(ENV, { now: new Date(NOW.getTime() + 60_000), fetch: fetcher })).toEqual({
      synced: 0, skipped: 0, errors: 0,
    });
  });
});
