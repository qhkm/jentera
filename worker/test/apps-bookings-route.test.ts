import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApps } from '../src/routes/apps';
import { myDate } from '../src/apps/bookings/time';
import {
  CALENDAR_DISCONNECTED_ADD, CALENDAR_DISCONNECTED_CLEANUP, CALENDAR_RECONNECT, processBookingCalendarJob,
} from '../src/apps/bookings/calendar-sync';
import { saveConnection } from '../src/connections';
import { GOOGLE_CALENDAR_SCOPES, calendarSecret } from '../src/connectors/google-calendar';
import { asOwner, asTenant, fetchFake, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };
const ENV = testEnv({
  APPS_ENABLED: 'true', APPS_BUSINESS_IDS: `${A},${B}`, SITES_ORIGIN: 'https://sites.test',
  GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
});
let ownerA = '';
let ownerAId = '';
let ownerB = '';
let staffA = '';
let serviceA = '';

type Calendar = { status: string; error: string | null; reason: string | null; canRetry: boolean; account: string | null };
type Json = {
  ok: boolean; code?: string; calendarQueued?: boolean; whatsappUrl: string | null;
  booking: { id: string; status: string; expired: boolean; calendar: Calendar; whatsappUrl: string | null };
};

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql): Promise<Record<string, string> & { service: string }> => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'SEIDO Coffee', 'services', true), (${B}, 'Beta', 'salon', true)`;
    // Team plan so the staff membership below actually resolves (verifySession
    // skips staff memberships on a non-team business).
    await sql`update business set plan = 'team' where id = ${A}`;
    const users = await sql<{ id: string; email: string }[]>`insert into app_user (email, email_verified)
      values ('a@example.com', true), ('b@example.com', true), ('s@example.com', true) returning id, email`;
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
    await sql`insert into membership (user_id, business_id, role) values
      (${byEmail['a@example.com']}, ${A}, 'owner'), (${byEmail['b@example.com']}, ${B}, 'owner'),
      (${byEmail['s@example.com']}, ${A}, 'staff')`;
    // B is installed too, so a cross-tenant request genuinely reaches the
    // business_id-scoped queries (and RLS) instead of short-circuiting on
    // "not installed".
    await sql`insert into app_installation (business_id, app_key, public_slug) values
      (${A}, 'bookings', 'seido'), (${B}, 'bookings', 'beta')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at) values
      (${A}, now()), (${B}, now())`;
    const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'cupping class', 60, 4) returning id`;
    return { ...byEmail, service: s.id };
  });
  ownerAId = ids['a@example.com'];
  ownerA = await signIn(ids['a@example.com']);
  ownerB = await signIn(ids['b@example.com']);
  staffA = await signIn(ids['s@example.com']);
  serviceA = ids.service;
});

async function call(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
  withOrigin = true,
  execution?: { waitUntil(promise: Promise<unknown>): void },
) {
  const shaped = req(method, path, { cookie, body });
  const headers = new Headers(shaped.request.headers);
  if (withOrigin) headers.set('Origin', CORS['Access-Control-Allow-Origin']);
  const res = await handleApps(new Request(shaped.request, { headers }), ENV, shaped.url, CORS, execution);
  if (!res) throw new Error('apps route did not handle the request');
  return res;
}

/** Collects what a route hands to waitUntil, without waiting for it. */
function recorder() {
  const scheduled: Promise<unknown>[] = [];
  return { execution: { waitUntil: (promise: Promise<unknown>) => { scheduled.push(promise); } }, scheduled };
}

const connectGoogle = () => asOwner((sql) => sql<{ id: string }[]>`insert into connection (business_id, connector, method, status)
  values (${A}, 'google', 'oauth', 'connected') returning id`);
const calendarRow = async (id: string) => {
  const [row] = await asOwner((sql) => sql<{ calendar_status: string; calendar_error: string | null; calendar_connection_id: string | null }[]>`
    select calendar_status, calendar_error, calendar_connection_id from booking where id = ${id}`);
  return row;
};
const jobRow = () => asOwner((sql) => sql`select desired, revision, attempts from booking_calendar_job`);

/** A Google account connected the way the OAuth callback does it, with a real sealed credential. */
const connectAccount = (account: string, email: string) => asTenant(A, (tx) => saveConnection(ENV, tx, A, {
  connector: 'google', method: 'oauth', externalId: account, displayName: email,
  secret: calendarSecret({
    subject: account, email, name: null, refreshToken: `refresh-${account}`, scopes: [...GOOGLE_CALENDAR_SCOPES],
  }),
  connectedBy: ownerAId, scopes: [...GOOGLE_CALENDAR_SCOPES],
}));

/** Stands in for Google on the global fetch the route's Calendar attempt uses; anything else
    it is asked for fails the attempt rather than leaving the machine. */
function stubGoogle() {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal('fetch', fetchFake(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access' });
    if (method === 'POST' && url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) {
      const sent = JSON.parse(String(init?.body)) as { id: string };
      return Response.json({ id: sent.id, status: 'confirmed' });
    }
    return new Response(null, { status: 599 });
  }));
  return { calls, creates: () => calls.filter((c) => c.method === 'POST' && c.url.includes('/events')) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function booking(startsAt: string, over: { status?: string; party?: number; ref?: string; minutes?: number } = {}) {
  const [row] = await asOwner((sql) => sql<{ id: string }[]>`
    insert into booking (business_id, reference, submission_key, submission_hash, service_id, service_name,
      starts_at, ends_at, party_size, customer_name, customer_phone, status)
    values (${A}, ${over.ref ?? 'K7Q2MP'}, gen_random_uuid(), 'h', ${serviceA}, 'cupping class',
      ${startsAt}::timestamptz, ${startsAt}::timestamptz + make_interval(mins => ${over.minutes ?? 60}),
      ${over.party ?? 2}, 'Aisyah', '60123456789', ${over.status ?? 'pending'})
    returning id`);
  return row.id;
}
const inDays = (days: number, hourUtc = 7) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};

describe('listing bookings', () => {
  it('groups by Malaysian date, pending first, and pages with a cursor', async () => {
    // 00:30 on 27 Sep in Malaysia is 16:30 UTC on 26 Sep.
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status)
      values
      (${A}, 'AAAAAA', gen_random_uuid(), 'h', ${serviceA}, 'cupping class', '2026-09-26T16:30:00Z', '2026-09-26T17:30:00Z', 1, 'Late', '60123456789', 'confirmed'),
      (${A}, 'BBBBBB', gen_random_uuid(), 'h', ${serviceA}, 'cupping class', '2026-09-27T05:00:00Z', '2026-09-27T06:00:00Z', 1, 'Pending', '60123456789', 'pending'),
      (${A}, 'CCCCCC', gen_random_uuid(), 'h', ${serviceA}, 'cupping class', '2026-09-26T08:00:00Z', '2026-09-26T09:00:00Z', 1, 'Earlier', '60123456789', 'confirmed')`);
    const day = await jsonOf<{ bookings: Array<{ customerName: string }> }>(
      await call('GET', '/api/apps/bookings/bookings?from=2026-09-27&days=1', ownerA));
    expect(day.bookings.map((b) => b.customerName)).toEqual(['Pending', 'Late']);
    const first = await jsonOf<{ bookings: Array<{ customerName: string }>; nextCursor: string | null }>(
      await call('GET', '/api/apps/bookings/bookings?from=2026-09-26&days=2&limit=2', ownerA));
    expect(first.bookings.map((b) => b.customerName)).toEqual(['Earlier', 'Pending']);
    const rest = await jsonOf<{ bookings: Array<{ customerName: string }>; nextCursor: string | null }>(
      await call('GET', `/api/apps/bookings/bookings?from=2026-09-26&days=2&limit=2&cursor=${first.nextCursor}`, ownerA));
    expect(rest.bookings.map((b) => b.customerName)).toEqual(['Late']);
    expect(rest.nextCursor).toBeNull();
  });

  it('refuses a bad window and hides another business', async () => {
    expect((await call('GET', '/api/apps/bookings/bookings?from=2026-02-30', ownerA)).status).toBe(400);
    expect((await call('GET', '/api/apps/bookings/bookings?from=2026-09-27&days=32', ownerA)).status).toBe(400);
    const id = await booking(inDays(2));
    expect((await call('GET', `/api/apps/bookings/bookings/${id}`, ownerA)).status).toBe(200);
    expect((await call('GET', `/api/apps/bookings/bookings/${id}`, ownerB)).status).toBe(404);
  });
});

describe('deciding', () => {
  it('confirms, queues a Calendar job when Google is connected, and repeats safely', async () => {
    await asOwner((sql) => sql`insert into connection (business_id, connector, method, status) values (${A}, 'google', 'oauth', 'connected')`);
    const id = await booking(inDays(2));
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect(res.status).toBe(200);
    const body = await jsonOf<Json>(res);
    expect(body.booking).toMatchObject({ status: 'confirmed', calendar: { status: 'pending' } });
    expect(decodeURIComponent(body.whatsappUrl!)).toContain('is confirmed. Ref K7Q2MP. See you at SEIDO Coffee.');
    const again = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect(again.status).toBe(200);
    const jobs = await asOwner((sql) => sql<{ desired: string; revision: number }[]>`select desired, revision from booking_calendar_job`);
    expect(jobs).toEqual([{ desired: 'present', revision: 1 }]);
  });

  it('marks Calendar not connected when there is no Google connection', async () => {
    const id = await booking(inDays(2));
    const body = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }));
    expect(body.booking.calendar.status).toBe('not_connected');
    expect(await asOwner((sql) => sql`select 1 from booking_calendar_job`)).toHaveLength(0);
  });

  it('refuses a conflicting decision, an expired request, and another business', async () => {
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'decline' });
    const conflict = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'ALREADY_DECIDED' });
    const past = await booking(new Date(Date.now() - 3_600_000).toISOString(), { ref: 'PPPPPP' });
    const expired = await call('POST', `/api/apps/bookings/bookings/${past}/decide`, ownerA, { decision: 'confirm' });
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ code: 'EXPIRED' });
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerB, { decision: 'confirm' })).status).toBe(404);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'maybe' })).status).toBe(400);
  });

  it('lets exactly one of two concurrent decisions win', async () => {
    const id = await booking(inDays(2));
    const [a, b] = await Promise.all([
      call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }),
      call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'decline' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('writes the WhatsApp text in Malay for a Malay business', async () => {
    await asOwner((sql) => sql`update business set lang = 'bm' where id = ${A}`);
    const id = await booking(inDays(2));
    const body = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }));
    expect(decodeURIComponent(body.whatsappUrl!)).toContain('telah disahkan');
  });

  it('refuses a decision with no Origin header', async () => {
    const id = await booking(inDays(2));
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }, false);
    expect(res.status).toBe(403);
  });
});

describe('cancelling', () => {
  it('releases the place, keeps the confirmation, and queues removal when an event may exist', async () => {
    await asOwner((sql) => sql`insert into connection (business_id, connector, method, status) values (${A}, 'google', 'oauth', 'connected')`);
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA);
    expect(res.status).toBe(200);
    const body = await jsonOf<Json>(res);
    expect(body.booking).toMatchObject({ status: 'cancelled', calendar: { status: 'pending' } });
    expect(decodeURIComponent(body.whatsappUrl!)).toContain('has been cancelled');
    const [row] = await asOwner((sql) => sql<{ decided_at: Date | null; cancelled_at: Date | null }[]>`
      select decided_at, cancelled_at from booking where id = ${id}`);
    expect(row.decided_at).not.toBeNull();
    expect(row.cancelled_at).not.toBeNull();
    expect(await asOwner((sql) => sql`select desired, revision from booking_calendar_job`)).toEqual([{ desired: 'absent', revision: 2 }]);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA)).status).toBe(200);
    expect(await asOwner((sql) => sql`select revision from booking_calendar_job`)).toEqual([{ revision: 2 }]);
  });

  it('needs no Calendar cleanup when none was ever connected, and refuses pending or started bookings', async () => {
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA);
    expect(await asOwner((sql) => sql`select 1 from booking_calendar_job`)).toHaveLength(0);
    const pending = await booking(inDays(3), { ref: 'QQQQQQ' });
    expect((await call('POST', `/api/apps/bookings/bookings/${pending}/cancel`, ownerA)).status).toBe(409);
    const started = await booking(new Date(Date.now() - 600_000).toISOString(), { ref: 'RRRRRR', status: 'confirmed' });
    const res = await call('POST', `/api/apps/bookings/bookings/${started}/cancel`, ownerA);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'EXPIRED' });
  });

  it('counts only future pending requests on the apps list', async () => {
    await booking(inDays(2));
    await booking(new Date(Date.now() - 3_600_000).toISOString(), { ref: 'LDLDLD' });
    const listed = await jsonOf<{ apps: Array<{ pending: number }> }>(await call('GET', '/api/apps', ownerA));
    expect(listed.apps[0].pending).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('lets a second, installed business neither read nor change another business\'s bookings or jobs', async () => {
    // Business B is installed too (see beforeEach), so these requests reach
    // the real business_id-scoped queries and RLS rather than stopping at
    // "app not installed" — the gap the review flagged.
    await asOwner((sql) => sql`insert into connection (business_id, connector, method, status) values (${A}, 'google', 'oauth', 'connected')`);
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });

    const from = myDate(new Date());
    const list = await jsonOf<{ bookings: Array<{ id: string }> }>(
      await call('GET', `/api/apps/bookings/bookings?from=${from}&days=31`, ownerB));
    expect(list.bookings).toEqual([]);
    expect((await call('GET', `/api/apps/bookings/bookings/${id}`, ownerB)).status).toBe(404);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerB, { decision: 'confirm' })).status).toBe(404);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerB)).status).toBe(404);

    const [row] = await asOwner((sql) => sql<{ status: string; decided_at: Date | null; cancelled_at: Date | null }[]>`
      select status, decided_at, cancelled_at from booking where id = ${id}`);
    expect(row.status).toBe('confirmed');
    expect(row.decided_at).not.toBeNull();
    expect(row.cancelled_at).toBeNull();
    const jobs = await asOwner((sql) => sql<{ desired: string; revision: number }[]>`select desired, revision from booking_calendar_job`);
    expect(jobs).toEqual([{ desired: 'present', revision: 1 }]);
  });

  it('refuses a staff member on every bookings route', async () => {
    const id = await booking(inDays(2));
    const from = myDate(new Date());
    expect((await call('GET', `/api/apps/bookings/bookings?from=${from}&days=31`, staffA)).status).toBe(403);
    expect((await call('GET', `/api/apps/bookings/bookings/${id}`, staffA)).status).toBe(403);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/decide`, staffA, { decision: 'confirm' })).status).toBe(403);
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, staffA)).status).toBe(403);
  });
});

describe('Calendar sync from the owner side', () => {
  it('starts the first attempt after the decision commits, without waiting for it', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    const r = recorder();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }, true, r.execution);
    expect((await jsonOf<Json>(res)).booking.calendar.status).toBe('pending');
    expect(r.scheduled).toHaveLength(1);
    await Promise.all(r.scheduled);
    // This connection has no stored credential, so the attempt asks for a reconnect.
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'failed', calendar_error: CALENDAR_RECONNECT });

    const repeat = recorder();
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }, true, repeat.execution);
    expect(repeat.scheduled).toHaveLength(0);
    const declined = await booking(inDays(3), { ref: 'QQQQQQ' });
    const d = recorder();
    await call('POST', `/api/apps/bookings/bookings/${declined}/decide`, ownerA, { decision: 'decline' }, true, d.execution);
    expect(d.scheduled).toHaveLength(0);
  });

  it('retries a failed sync once, leaves a queued one alone, and does nothing for finished work', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job set attempts = 8, last_error = 'x'`;
      await sql`update booking set calendar_status = 'failed', calendar_error = 'x' where id = ${id}`;
    });
    const r = recorder();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, r.execution);
    expect(res.status).toBe(200);
    expect((await jsonOf<Json>(res)).booking.calendar.status).toBe('pending');
    expect(r.scheduled).toHaveLength(1);
    await Promise.all(r.scheduled);

    // Queued and not yet attempted: a second tap changes nothing.
    await asOwner((sql) => sql`update booking_calendar_job set attempts = 0, completed_revision = null`);
    const before = await jobRow();
    const twice = recorder();
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, twice.execution)).status).toBe(200);
    expect(twice.scheduled).toHaveLength(0);
    expect(await jobRow()).toEqual(before);

    // Done: the event exists.
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job set completed_revision = revision`;
      await sql`update booking set calendar_status = 'created', calendar_error = null where id = ${id}`;
    });
    const done = recorder();
    await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, done.execution);
    expect(done.scheduled).toHaveLength(0);
    expect((await calendarRow(id)).calendar_status).toBe('created');
  });

  it('pins a Calendar connected after the booking was confirmed', async () => {
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA)).status).toBe(200);
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'not_connected', calendar_connection_id: null });
    expect(await jobRow()).toHaveLength(0);

    const [connection] = await connectGoogle();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA);
    expect((await jsonOf<Json>(res)).booking.calendar.status).toBe('pending');
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'pending', calendar_connection_id: connection.id });
    expect(await jobRow()).toEqual([{ desired: 'present', revision: 1, attempts: 0 }]);
  });

  it('refuses retry for bookings that cannot have an event, and cleanup whose connection is gone', async () => {
    const pending = await booking(inDays(2));
    const notRetryable = await call('POST', `/api/apps/bookings/bookings/${pending}/calendar/retry`, ownerA);
    expect(notRetryable.status).toBe(409);
    expect(await notRetryable.json()).toMatchObject({ code: 'NOT_RETRYABLE' });

    await connectGoogle();
    const id = await booking(inDays(3), { ref: 'QQQQQQ' });
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job set completed_revision = revision`;
      await sql`update booking set calendar_status = 'created' where id = ${id}`;
      await sql`delete from connection`;   // the pin becomes null
    });
    await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA);
    expect(await processBookingCalendarJob(ENV, A, id)).toBe('failed');
    expect((await calendarRow(id)).calendar_error).toBe(CALENDAR_DISCONNECTED_CLEANUP);
    const refused = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'CALENDAR_DISCONNECTED' });
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, staffA)).status).toBe(403);
  });

  it('clears an old Calendar error when a cancel queues cleanup', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner((sql) => sql`update booking set calendar_status = 'failed', calendar_reason = 'provider',
      calendar_error = 'Google Calendar could not complete that request (500).' where id = ${id}`);
    const r = recorder();
    const body = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA, undefined, true, r.execution));
    expect(body.calendarQueued).toBe(true);
    expect(body.booking.calendar).toMatchObject({ status: 'pending', error: null, reason: null });
    expect(r.scheduled).toHaveLength(1);
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'pending', calendar_error: null });
    await Promise.all(r.scheduled);
  });

  it('leaves a job whose last attempt still holds a live lease alone', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner((sql) => sql`update booking_calendar_job set attempts = 8, lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '1 minute'`);
    const before = await jobRow();
    const r = recorder();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, r.execution);
    expect(res.status).toBe(200);
    expect(r.scheduled).toHaveLength(0);
    expect(await jobRow()).toEqual(before);
  });

  it('re-queues an orphaned job whose lease has expired', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    // A Worker-clock date well in the past, so clock skew between the test and Postgres cannot
    // make the lease look live to retryCalendar, which compares it with the Worker's clock.
    await asOwner((sql) => sql`update booking_calendar_job set attempts = 8, lease_token = gen_random_uuid(),
      lease_expires_at = ${new Date(Date.now() - 5 * 60_000)}`);
    const before = await jobRow();
    const r = recorder();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, r.execution);
    expect(res.status).toBe(200);
    expect(r.scheduled).toHaveLength(1);
    const after = await jobRow();
    expect(after[0].revision).toBeGreaterThan(before[0].revision);
    expect(after[0].attempts).toBe(0);
    await Promise.all(r.scheduled);
  });

  it('retries a cancelled booking whose cleanup was given up on', async () => {
    const [connection] = await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await call('POST', `/api/apps/bookings/bookings/${id}/cancel`, ownerA);
    await asOwner(async (sql) => {
      await sql`update booking_calendar_job set attempts = 8`;
      await sql`update booking set calendar_status = 'failed' where id = ${id}`;
    });
    const before = await jobRow();
    const r = recorder();
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA, undefined, true, r.execution);
    expect(res.status).toBe(200);
    expect(r.scheduled).toHaveLength(1);
    const after = await jobRow();
    expect(after[0].desired).toBe('absent');
    expect(after[0].revision).toBeGreaterThan(before[0].revision);
    expect(await calendarRow(id)).toMatchObject({ calendar_connection_id: connection.id });
    await Promise.all(r.scheduled);
  });

  it('refuses another business\'s booking with a plain 404', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    expect((await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerB)).status).toBe(404);
  });

  it('adds the event end to end: the confirm hands the first attempt on, and it creates the event', async () => {
    const google = stubGoogle();
    const connection = await connectAccount('account-1', 'owner@example.com');
    const id = await booking(inDays(2));
    const r = recorder();
    const body = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA,
      { decision: 'confirm' }, true, r.execution));
    expect(body.calendarQueued).toBe(true);
    expect(body.booking.calendar).toEqual({
      status: 'pending', error: null, reason: null, canRetry: false, account: 'owner@example.com',
    });
    expect(r.scheduled).toHaveLength(1);
    await Promise.all(r.scheduled);
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'created', calendar_error: null, calendar_connection_id: connection.id });
    expect(google.creates()).toHaveLength(1);
  });

  it('says why a sync failed, and lets the owner retry once the same Google account is back, never another', async () => {
    const google = stubGoogle();
    const first = await connectAccount('account-1', 'owner@example.com');
    const id = await booking(inDays(2));
    await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' });
    await asOwner((sql) => sql`delete from connection where id = ${first.id}`);
    await connectAccount('account-2', 'other@example.com');
    expect(await processBookingCalendarJob(ENV, A, id)).toBe('failed');
    expect(google.calls).toHaveLength(0);

    const failed = await jsonOf<Json>(await call('GET', `/api/apps/bookings/bookings/${id}`, ownerA));
    expect(failed.booking.calendar).toEqual({
      status: 'failed', error: CALENDAR_DISCONNECTED_ADD, reason: 'disconnected', canRetry: true, account: 'owner@example.com',
    });
    // Only the other account is connected: retry is refused rather than switching accounts.
    const refused = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'CALENDAR_DISCONNECTED' });
    expect(await calendarRow(id)).toMatchObject({ calendar_connection_id: null });

    const again = await connectAccount('account-1', 'owner@example.com');
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/calendar/retry`, ownerA);
    expect(res.status).toBe(200);
    const retried = await jsonOf<Json>(res);
    expect(retried.calendarQueued).toBe(true);
    expect(retried.booking.calendar).toEqual({
      status: 'pending', error: null, reason: null, canRetry: false, account: 'owner@example.com',
    });
    expect(await calendarRow(id)).toMatchObject({ calendar_status: 'pending', calendar_connection_id: again.id });
    expect(await jobRow()).toEqual([{ desired: 'present', revision: 2, attempts: 0 }]);
  });

  it('offers no retry for an event the owner deleted in Google, and says nothing was queued', async () => {
    await connectGoogle();
    const id = await booking(inDays(2));
    const confirmed = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }));
    expect(confirmed.calendarQueued).toBe(true);
    await asOwner((sql) => sql`update booking set calendar_status = 'failed', calendar_reason = 'removed_in_google',
      calendar_error = 'x' where id = ${id}`);
    const shown = await jsonOf<Json>(await call('GET', `/api/apps/bookings/bookings/${id}`, ownerA));
    expect(shown.booking.calendar).toMatchObject({ status: 'failed', reason: 'removed_in_google', canRetry: false });
    const again = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${id}/decide`, ownerA, { decision: 'confirm' }));
    expect(again.calendarQueued).toBe(false);
    const notConnected = await booking(inDays(3), { ref: 'QQQQQQ' });
    const unpinned = await jsonOf<Json>(await call('POST', `/api/apps/bookings/bookings/${notConnected}/decide`, ownerA, { decision: 'decline' }));
    expect(unpinned).toMatchObject({ calendarQueued: false, booking: { calendar: { status: 'none', canRetry: false, account: null } } });
  });
});

describe('route dispatch', () => {
  it('reads the action whatever its case, and never hands a decision to retry or cancel', async () => {
    const id = await booking(inDays(2));
    const res = await call('POST', `/api/apps/bookings/bookings/${id}/DECIDE`, ownerA, { decision: 'confirm' });
    expect(res.status).toBe(200);
    expect((await jsonOf<Json>(res)).booking.status).toBe('confirmed');
    const retry = await call('POST', `/api/apps/bookings/bookings/${id}/Calendar/Retry`, ownerA);
    expect(retry.status).toBe(200);
    expect((await jsonOf<Json>(retry)).booking.status).toBe('confirmed');
  });
});
