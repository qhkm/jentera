import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelBooking } from '../src/apps/bookings/bookings';
import {
  CALENDAR_DISCONNECTED_ADD, CALENDAR_DISCONNECTED_CLEANUP, CALENDAR_MAX_ATTEMPTS, CALENDAR_RECONNECT,
  CALENDAR_REMOVED_IN_GOOGLE, CALENDAR_UNCONFIRMED, processBookingCalendarJob, sweepBookingCalendar,
} from '../src/apps/bookings/calendar-sync';
import { saveConnection } from '../src/connections';
import { GOOGLE_CALENDAR_SCOPES, calendarEventId, calendarSecret } from '../src/connectors/google-calendar';
import { asApp, asOwner, asTenant, fetchFake, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const ENV = testEnv({
  APPS_ENABLED: 'true', APPS_BUSINESS_IDS: A,
  GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
});
const NOW = new Date('2026-10-05T00:00:00Z');   // Monday 08:00 in Malaysia
const at = (ms = 0) => () => new Date(NOW.getTime() + ms);
let owner = '';
let service = '';
let bookingId = '';
let connectionId = '';

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded) values (${A}, 'SEIDO Coffee', 'services', true)`;
    const [u] = await sql<{ id: string }[]>`insert into app_user (email, email_verified) values ('o@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${u.id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Cupping class', 60, 4) returning id`;
    return { owner: u.id, service: s.id };
  });
  owner = ids.owner;
  service = ids.service;
  const connection = await asTenant(A, (tx) => saveConnection(ENV, tx, A, {
    connector: 'google', method: 'oauth', externalId: 'account-1', displayName: 'owner@example.com',
    secret: calendarSecret({
      subject: 'account-1', email: 'owner@example.com', name: 'Owner', refreshToken: 'refresh-secret',
      scopes: [...GOOGLE_CALENDAR_SCOPES],
    }),
    connectedBy: owner, scopes: [...GOOGLE_CALENDAR_SCOPES],
  }));
  connectionId = connection.id;
  bookingId = await asOwner(async (sql) => {
    const [b] = await sql<{ id: string }[]>`insert into booking (business_id, reference, submission_key, submission_hash,
        service_id, service_name, starts_at, ends_at, party_size, customer_name, customer_phone, note, status,
        decided_at, decided_by, calendar_status, calendar_connection_id, calendar_account, calendar_account_label)
      values (${A}, 'K7Q2MP', gen_random_uuid(), 'h', ${service}, 'Cupping class',
        '2026-10-06T02:00:00Z', '2026-10-06T03:00:00Z', 2, 'Aisyah', '60123456789', 'Window seat', 'confirmed',
        ${NOW}, ${owner}, 'pending', ${connectionId}, 'account-1', 'owner@example.com')
      returning id`;
    await sql`insert into booking_calendar_job (business_id, booking_id, desired, next_attempt_at)
      values (${A}, ${b.id}, 'present', ${NOW})`;
    return b.id;
  });
});

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** A fake Google. The token endpoint answers first; then POST creates, DELETE
    removes, and GET reads an event back. */
function google(over: { token?: Handler; create?: Handler; read?: Handler; remove?: Handler } = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fake = fetchFake(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url === 'https://oauth2.googleapis.com/token') {
      return over.token ? over.token(init) : Response.json({ access_token: 'access' });
    }
    if (method === 'POST') {
      return over.create ? over.create(init) : Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
    }
    if (method === 'DELETE') return over.remove ? over.remove(init) : new Response(null, { status: 204 });
    return over.read ? over.read(init) : Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
  });
  const creates = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/events'));
  return { fetch: fake as unknown as typeof fetch, calls, creates };
}

async function state() {
  const [row] = await asOwner((sql) => sql<{
    calendar_status: string; calendar_error: string | null; calendar_reason: string | null;
    calendar_event_id: string | null; calendar_connection_id: string | null; calendar_account: string | null;
    desired: string; attempts: number; revision: number; completed_revision: number | null;
    next_attempt_at: Date; lease_token: string | null; last_error: string | null;
  }[]>`
    select b.calendar_status, b.calendar_error, b.calendar_reason, b.calendar_event_id, b.calendar_connection_id,
           b.calendar_account, j.desired, j.attempts, j.revision, j.completed_revision, j.next_attempt_at,
           j.lease_token, j.last_error
      from booking b join booking_calendar_job j on j.business_id = b.business_id and j.booking_id = b.id
     where b.id = ${bookingId}`);
  return row;
}

/** Connect a Google account the way the OAuth callback does: one row per account. */
function connectAccount(account: string, email: string) {
  return asTenant(A, (tx) => saveConnection(ENV, tx, A, {
    connector: 'google', method: 'oauth', externalId: account, displayName: email,
    secret: calendarSecret({
      subject: account, email, name: null, refreshToken: `refresh-${account}`, scopes: [...GOOGLE_CALENDAR_SCOPES],
    }),
    connectedBy: owner, scopes: [...GOOGLE_CALENDAR_SCOPES],
  }));
}

/** Disconnecting deletes the row; the booking's pin falls to null with it. */
const disconnect = (id: string) => asOwner((sql) => sql`delete from connection where id = ${id}`);

async function cancelInDatabase() {
  await asOwner(async (sql) => {
    await sql`update booking set status = 'cancelled', cancelled_at = ${NOW}, cancelled_by = ${owner} where id = ${bookingId}`;
    await sql`update booking_calendar_job set desired = 'absent', revision = revision + 1 where booking_id = ${bookingId}`;
  });
}

describe('processBookingCalendarJob', () => {
  it('creates the event once, records it, and leaves nothing due', async () => {
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    expect(await state()).toMatchObject({
      calendar_status: 'created', calendar_error: null, calendar_reason: null, calendar_event_id: calendarEventId(bookingId),
      attempts: 1, revision: 1, completed_revision: 1, lease_token: null,
    });
    const sent = JSON.parse(g.creates()[0].body!);
    expect(sent).toMatchObject({
      id: calendarEventId(bookingId),
      summary: 'Cupping class · Aisyah (2)',
      start: { dateTime: '2026-10-06T10:00:00+08:00', timeZone: 'Asia/Kuala_Lumpur' },
      end: { dateTime: '2026-10-06T11:00:00+08:00', timeZone: 'Asia/Kuala_Lumpur' },
    });
    expect(sent.description).toBe('Ref K7Q2MP\nPhone +60123456789\nNote: Window seat');
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(1_000) })).toBe('idle');
    expect(g.creates()).toHaveLength(1);
  });

  it('removes the event for a cancelled booking, and counts an event already gone as removed', async () => {
    await cancelInDatabase();
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('removed');
    expect(g.calls.find((c) => c.method === 'DELETE')!.url)
      .toContain(`/events/${calendarEventId(bookingId)}?sendUpdates=none`);
    expect(await state()).toMatchObject({ calendar_status: 'removed', calendar_error: null, calendar_reason: null, completed_revision: 2 });
    expect(g.creates()).toHaveLength(0);

    await cancelInDatabase();   // another revision to reconcile
    const gone = google({ remove: () => new Response('{}', { status: 410 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: gone.fetch, now: at(1_000) })).toBe('removed');
    expect(await state()).toMatchObject({ calendar_status: 'removed', completed_revision: 3 });
  });

  it('treats a 404 delete the same as a 410: the event is already gone', async () => {
    await cancelInDatabase();
    const g = google({ remove: () => new Response(null, { status: 404 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('removed');
    expect(await state()).toMatchObject({ calendar_status: 'removed', completed_revision: 2 });
  });

  it('never records a create that a cancel overtook, and removes the event in the same call', async () => {
    const g = google({
      create: async () => {
        // The owner cancels while Google is still answering the create.
        await asTenant(A, (tx) => cancelBooking(tx, A, bookingId, owner, NOW));
        return Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
      },
    });
    // The create's result is stale, so the call goes round once more at once and removes it,
    // rather than leaving the event in the owner's calendar until the next cron tick.
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('removed');
    expect(g.creates()).toHaveLength(1);
    expect(g.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(await state()).toMatchObject({
      calendar_status: 'removed', calendar_event_id: null, desired: 'absent', revision: 2, completed_revision: 2,
      lease_token: null,
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(1_000) })).toBe('idle');
  });

  it('picks up a job whose executor died holding the lease, and syncs even while bookings are paused', async () => {
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job
        set attempts = 1, lease_token = gen_random_uuid(), lease_expires_at = ${new Date(NOW.getTime() - 1_000)}`;
      await sql`update app_installation set state = 'paused'`;
      await sql`insert into booking_settings (business_id, availability_acknowledged_at, accepting) values (${A}, now(), false)`;
    });
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    expect(await state()).toMatchObject({ attempts: 2, lease_token: null, calendar_status: 'created' });
  });

  it('lets one executor at a time own a job', async () => {
    let second: string | null = null;
    const g = google({
      create: async () => {
        second = await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(500) });
        return Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
      },
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    expect(second).toBe('busy');
    expect(g.creates()).toHaveLength(1);
  });

  it('records nothing when another executor has taken the lease while Google was answering', async () => {
    let stolen = '';
    const g = google({
      create: async () => {
        // Simulates a second executor claiming the job after this lease looked expired.
        const [row] = await asOwner((sql) => sql<{ lease_token: string }[]>`update booking_calendar_job
          set lease_token = gen_random_uuid() where booking_id = ${bookingId} returning lease_token`);
        stolen = row.lease_token;
        return Response.json({ id: calendarEventId(bookingId), status: 'confirmed' });
      },
    });
    // Stale, so it goes round once more — and finds the other executor's lease still live.
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('busy');
    expect(await state()).toMatchObject({
      calendar_status: 'pending', calendar_event_id: null, lease_token: stolen,
    });
    expect(g.creates()).toHaveLength(1);
  });

  it('abandons a slow Google at the budget and tries again later', async () => {
    const g = google({
      create: (init) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(), budgetMs: 50 })).toBe('retrying');
    const row = await state();
    expect(row).toMatchObject({
      calendar_status: 'pending', attempts: 1, lease_token: null, last_error: 'Google Calendar did not answer in time.',
    });
    expect(row.next_attempt_at.toISOString()).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it('backs off after a failure and gives up after the last attempt', async () => {
    const g = google({ create: () => new Response('{}', { status: 500 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('retrying');
    await asOwner((sql) => sql`update booking_calendar_job set attempts = ${CALENDAR_MAX_ATTEMPTS - 1}, next_attempt_at = ${NOW}`);
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', attempts: CALENDAR_MAX_ATTEMPTS, calendar_reason: 'provider',
      calendar_error: 'Google Calendar could not complete that request (500).',
    });
    const due = await asApp((sql) => sql`select * from public.booking_calendar_due(${new Date(NOW.getTime() + 86_400_000)}, 50)`);
    expect(due).toHaveLength(0);
    const [connection] = await asOwner((sql) => sql<{ status: string; last_error: string | null }[]>`
      select status, last_error from connection where id = ${connectionId}`);
    expect(connection.status).toBe('connected');
    expect(connection.last_error).toContain('(500)');
  });

  it('asks for a reconnect when Google refuses the grant, without retrying', async () => {
    const g = google({ token: () => new Response('{}', { status: 400 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', attempts: CALENDAR_MAX_ATTEMPTS, calendar_reason: 'reconnect',
      calendar_error: 'Google Calendar access expired. Reconnect it to continue.',
    });
    const [connection] = await asOwner((sql) => sql<{ status: string }[]>`select status from connection where id = ${connectionId}`);
    expect(connection.status).toBe('expired');
  });

  it('retries a rate-limited create without asking for a reconnect', async () => {
    const g = google({
      create: () => Response.json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 403 }),
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('retrying');
    expect(await state()).toMatchObject({
      calendar_status: 'pending', attempts: 1, lease_token: null,
      last_error: 'Google Calendar is busy. Jentera will try again.',
    });
    const [connection] = await asOwner((sql) => sql<{ status: string }[]>`select status from connection where id = ${connectionId}`);
    expect(connection.status).toBe('connected');
  });

  it('retries when the token endpoint is down, without expiring the connection', async () => {
    const g = google({ token: () => new Response('{}', { status: 503 }) });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('retrying');
    expect(await state()).toMatchObject({ calendar_status: 'pending', last_error: 'Google Calendar could not be reached.' });
    const [connection] = await asOwner((sql) => sql<{ status: string }[]>`select status from connection where id = ${connectionId}`);
    expect(connection.status).toBe('connected');
  });

  it('does not re-add an event the owner deleted in Google', async () => {
    const g = google({
      create: () => new Response('{}', { status: 409 }),
      read: () => Response.json({ id: calendarEventId(bookingId), status: 'cancelled' }),
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', calendar_error: CALENDAR_REMOVED_IN_GOOGLE, calendar_reason: 'removed_in_google',
      calendar_event_id: null, completed_revision: 1,
    });
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(1_000) })).toBe('idle');
  });

  it('never removes through another account once the original connection is gone', async () => {
    await cancelInDatabase();
    await disconnect(connectionId);
    await connectAccount('account-2', 'other@example.com');
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', calendar_error: CALENDAR_DISCONNECTED_CLEANUP, calendar_reason: 'disconnected',
      calendar_connection_id: null, calendar_account: 'account-1',
    });
    expect(g.calls).toHaveLength(0);
  });

  it('gives up without a fetch when the pinned connection is already expired', async () => {
    await asOwner((sql) => sql`update connection set status = 'expired' where id = ${connectionId}`);
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', calendar_error: CALENDAR_RECONNECT, calendar_reason: 'reconnect', calendar_connection_id: connectionId,
    });
    expect(g.calls).toHaveLength(0);
  });

  it('gives up without a fetch when the pinned connection has no credential row', async () => {
    await asOwner(async (sql) => {
      const [c] = await sql<{ id: string }[]>`insert into connection
          (business_id, connector, method, status, external_id, display_name)
        values (${A}, 'google', 'oauth', 'connected', 'account-2', 'owner2@example.com')
        returning id`;
      await sql`update booking set calendar_connection_id = ${c.id} where id = ${bookingId}`;
    });
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({ calendar_status: 'failed', calendar_error: CALENDAR_RECONNECT, calendar_reason: 'reconnect' });
    expect(g.calls).toHaveLength(0);
  });

  it('gives up on an orphaned job whose executor never returned, without calling Google', async () => {
    await asOwner((sql) => sql`update booking_calendar_job
      set attempts = ${CALENDAR_MAX_ATTEMPTS}, lease_token = gen_random_uuid(),
          lease_expires_at = ${new Date(NOW.getTime() - 1_000)}`);
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(${NOW}, 50)`)).toHaveLength(1);
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', calendar_error: CALENDAR_UNCONFIRMED, calendar_reason: 'unconfirmed', attempts: CALENDAR_MAX_ATTEMPTS,
    });
    expect(g.calls).toHaveLength(0);
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(${NOW}, 50)`)).toHaveLength(0);
  });

  it('waits for a pilot that is switched off without spending an attempt', async () => {
    const off = testEnv({ ...ENV, APPS_BUSINESS_IDS: '22222222-2222-4222-8222-222222222222' });
    const g = google();
    expect(await processBookingCalendarJob(off, A, bookingId, { fetch: g.fetch, now: at() })).toBe('deferred');
    const row = await state();
    expect(row.attempts).toBe(0);
    expect(row.next_attempt_at.toISOString()).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
    expect(g.calls).toHaveLength(0);
  });

  it('keeps an orphan of a business off the pilot for later instead of failing it', async () => {
    const off = testEnv({ ...ENV, APPS_BUSINESS_IDS: '22222222-2222-4222-8222-222222222222' });
    await asOwner((sql) => sql`update booking_calendar_job
      set attempts = ${CALENDAR_MAX_ATTEMPTS}, lease_token = gen_random_uuid(),
          lease_expires_at = ${new Date(NOW.getTime() - 1_000)}`);
    const g = google();
    expect(await processBookingCalendarJob(off, A, bookingId, { fetch: g.fetch, now: at() })).toBe('deferred');
    const row = await state();
    expect(row).toMatchObject({ calendar_status: 'pending', calendar_reason: null, attempts: CALENDAR_MAX_ATTEMPTS });
    expect(row.next_attempt_at.toISOString()).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
    // Deferred means out of the due scan until then, orphan or not.
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(${NOW}, 50)`)).toHaveLength(0);
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await asApp((sql) => sql`select * from public.booking_calendar_due(${later}, 50)`)).toHaveLength(1);
    // Back on the pilot, the orphan is reported as before.
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: () => later })).toBe('failed');
    expect(await state()).toMatchObject({ calendar_status: 'failed', calendar_reason: 'unconfirmed' });
    expect(g.calls).toHaveLength(0);
  });

  it('logs an unexpected Google failure with the business and booking ids and nothing about the customer', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const g = google({ create: () => { throw new TypeError('network down'); } });
      expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('retrying');
      const lines = errSpy.mock.calls.map((call) => call.map(String).join(' '));
      const line = lines.find((l) => l.includes(' google '));
      expect(line).toBe(`[bookings-calendar] business=${A} booking=${bookingId} google TypeError`);
      expect(lines.join('\n')).not.toMatch(/Aisyah|60123456789|Window seat/);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('matches the due scan on the attempt limit', async () => {
    const [{ def }] = await asOwner((sql) => sql<{ def: string }[]>`
      select pg_get_functiondef('public.booking_calendar_due(timestamptz, integer)'::regprocedure) as def`);
    expect(def).toContain(`attempts < ${CALENDAR_MAX_ATTEMPTS}`);
    // The orphan branch's own limit, pinned separately: lowering CALENDAR_MAX_ATTEMPTS without
    // updating the SQL (or vice versa) must fail here, not just leave a job due forever.
    expect(def).toContain(`attempts >= ${CALENDAR_MAX_ATTEMPTS}`);
  });
});

describe('the Google account a booking lives in', () => {
  it('re-pins to the same account after a disconnect and reconnect, and adds the event there', async () => {
    await disconnect(connectionId);
    const again = await connectAccount('account-1', 'owner@example.com');
    expect(again.id).not.toBe(connectionId);
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    expect(await state()).toMatchObject({
      calendar_status: 'created', calendar_reason: null, calendar_connection_id: again.id, calendar_account: 'account-1',
    });
    expect(g.creates()).toHaveLength(1);
  });

  it('never adds the event to a different account: it gives up as disconnected and keeps no pin', async () => {
    await disconnect(connectionId);
    await connectAccount('account-2', 'other@example.com');
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('failed');
    expect(await state()).toMatchObject({
      calendar_status: 'failed', calendar_reason: 'disconnected', calendar_error: CALENDAR_DISCONNECTED_ADD,
      calendar_connection_id: null, calendar_account: 'account-1',
    });
    expect(g.calls).toHaveLength(0);
  });

  it('removes a cancelled booking\'s event through the same account connected again', async () => {
    const g = google();
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at() })).toBe('created');
    await disconnect(connectionId);
    const again = await connectAccount('account-1', 'owner@example.com');
    await asTenant(A, (tx) => cancelBooking(tx, A, bookingId, owner, NOW));
    expect(await processBookingCalendarJob(ENV, A, bookingId, { fetch: g.fetch, now: at(1_000) })).toBe('removed');
    expect(g.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(await state()).toMatchObject({
      calendar_status: 'removed', calendar_reason: null, calendar_connection_id: again.id,
    });
  });
});

describe('sweepBookingCalendar', () => {
  const B = '22222222-2222-4222-8222-222222222222';

  /** Business B, with a confirmed booking whose connection is gone:
      processing it asks for a reconnect without calling Google. */
  async function secondBusiness(dueAt: Date) {
    return asOwner(async (sql) => {
      await sql`insert into business (id, name, playbook_key, onboarded) values (${B}, 'Beta', 'salon', true)`;
      await sql`insert into app_installation (business_id, app_key, public_slug) values (${B}, 'bookings', 'beta')`;
      const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
        values (${B}, 'Haircut', 30, 1) returning id`;
      const [b] = await sql<{ id: string }[]>`insert into booking (business_id, reference, submission_key, submission_hash,
          service_id, service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status, calendar_status)
        values (${B}, 'M8R3NQ', gen_random_uuid(), 'h', ${s.id}, 'Haircut',
          '2026-10-06T02:00:00Z', '2026-10-06T02:30:00Z', 1, 'Aina', '60123456780', 'confirmed', 'pending')
        returning id`;
      await sql`insert into booking_calendar_job (business_id, booking_id, desired, next_attempt_at)
        values (${B}, ${b.id}, 'present', ${dueAt})`;
      return b.id;
    });
  }

  it('works through due jobs across businesses', async () => {
    const both = testEnv({ ...ENV, APPS_BUSINESS_IDS: `${A},${B}` });
    const other = await secondBusiness(NOW);
    const g = google();
    const summary = await sweepBookingCalendar(both, { fetch: g.fetch, now: at(1_000) });
    expect(summary).toEqual({ processed: 2, created: 1, removed: 0, retrying: 0, failed: 1, skipped: 0, errors: 0 });
    const [row] = await asOwner((sql) => sql<{ calendar_error: string | null; calendar_reason: string | null }[]>`
      select calendar_error, calendar_reason from booking where id = ${other}`);
    expect(row).toEqual({ calendar_error: CALENDAR_DISCONNECTED_ADD, calendar_reason: 'disconnected' });
    expect((await sweepBookingCalendar(both, { fetch: g.fetch, now: at(2_000) })).processed).toBe(0);
  });

  it('takes a bounded batch, and a switched-off pilot does not block the others', async () => {
    // A (off the list) is due first; B (on it) second. One job per sweep.
    const onlyB = testEnv({ ...ENV, APPS_BUSINESS_IDS: B });
    await secondBusiness(new Date(NOW.getTime() + 500));
    const g = google();
    const first = await sweepBookingCalendar(onlyB, { fetch: g.fetch, now: at(1_000), limit: 1 });
    expect(first).toMatchObject({ processed: 1, failed: 0, skipped: 1 });   // A was deferred an hour
    const second = await sweepBookingCalendar(onlyB, { fetch: g.fetch, now: at(1_000), limit: 1 });
    expect(second).toMatchObject({ processed: 1, failed: 1, skipped: 0 });  // B's turn
    expect(g.calls).toHaveLength(0);
  });

  it('starts no new job once the sweep has run for 40 seconds, leaving the rest due', async () => {
    const both = testEnv({ ...ENV, APPS_BUSINESS_IDS: `${A},${B}` });
    const other = await secondBusiness(new Date(NOW.getTime() + 500));   // due after A's
    const g = google();
    // A clock that has moved 40 s on by the time A's job is done.
    const clock = () => (g.calls.length ? 40_000 : 0);
    const summary = await sweepBookingCalendar(both, { fetch: g.fetch, now: at(1_000), clock });
    expect(summary).toEqual({ processed: 1, created: 1, removed: 0, retrying: 0, failed: 0, skipped: 0, errors: 0 });
    expect(await asApp((sql) => sql`select booking_id from public.booking_calendar_due(${new Date(NOW.getTime() + 1_000)}, 50)`))
      .toEqual([{ booking_id: other }]);
  });

  it('leaves a job alone while another executor holds its lease', async () => {
    await asOwner((sql) => sql`update booking_calendar_job
      set lease_token = gen_random_uuid(), lease_expires_at = ${new Date(NOW.getTime() + 60_000)}`);
    const g = google();
    expect((await sweepBookingCalendar(ENV, { fetch: g.fetch, now: at(1_000) })).processed).toBe(0);
    expect(g.calls).toHaveLength(0);
  });

  it('does not touch the database while apps are switched off', async () => {
    const off = testEnv({
      APPS_ENABLED: 'false',
      HYPERDRIVE: { connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none' },
    });
    expect(await sweepBookingCalendar(off)).toEqual({
      processed: 0, created: 0, removed: 0, retrying: 0, failed: 0, skipped: 0, errors: 0,
    });
  });

  it('defers a job whose processing throws, so it does not sit at the head of every sweep', async () => {
    // A credential row with a key version this env cannot decrypt: vault.ts throws
    // `no credential key for version 99`, which claim() rethrows (Task 2) rather
    // than treating it as a broken grant — a database/credential fault, not the
    // owner's problem, and not a spent attempt.
    await asOwner((sql) => sql`update credential set key_version = 99 where connection_id = ${connectionId}`);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const g = google();
      const now = at(1_000);
      const summary = await sweepBookingCalendar(ENV, { fetch: g.fetch, now });
      expect(summary).toEqual({ processed: 0, created: 0, removed: 0, retrying: 0, failed: 0, skipped: 0, errors: 1 });
      const row = await state();
      expect(row.attempts).toBe(0);
      expect(row.lease_token).toBeNull();
      expect(row.next_attempt_at.toISOString()).toBe(new Date(now().getTime() + 5 * 60_000).toISOString());
      expect(g.calls).toHaveLength(0);

      const again = await sweepBookingCalendar(ENV, { fetch: g.fetch, now });
      expect(again).toEqual({ processed: 0, created: 0, removed: 0, retrying: 0, failed: 0, skipped: 0, errors: 0 });
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
