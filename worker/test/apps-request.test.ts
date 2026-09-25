import { beforeEach, describe, expect, it } from 'vitest';
import { newReference, REFERENCE } from '../src/apps/bookings/reference';
import {
  createBookingRequest, DAILY_CAP, findSubmission, parseRequestForm, submissionDigest, type RequestInput,
} from '../src/apps/bookings/request';
import { asOwner, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const ENV = testEnv();
const NOW = new Date('2026-10-05T00:00:00Z'); // Mon 08:00 Malaysia
const TEN = new Date('2026-10-06T02:00:00Z'); // Tue 10:00 Malaysia
let service = '';
let second = '';
let owners: string[] = [];

beforeEach(async () => {
  await truncateAll();
  const ids = await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded, lang) values (${A}, 'SEIDO Coffee', 'services', true, 'en')`;
    const users = await sql<{ id: string }[]>`insert into app_user (email, email_verified)
      values ('o1@example.com', true), ('o2@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${users[0].id}, ${A}, 'owner'), (${users[1].id}, ${A}, 'owner')`;
    await sql`insert into app_installation (business_id, app_key, public_slug) values (${A}, 'bookings', 'seido')`;
    await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days)
      values (${A}, now(), 120, 30)`;
    const [s1] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Cupping class', 60, 1) returning id`;
    const [s2] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
      values (${A}, 'Espresso basics', 60, 5) returning id`;
    // Monday 08:00-11:00 exists only to test the notice: at NOW (Mon 08:00)
    // with 120 minutes' notice, 08:00 and 09:00 are too soon.
    await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes)
      values (${A}, ${s1.id}, 2, '10:00', '13:00'), (${A}, ${s2.id}, 2, '10:00', '13:00'),
             (${A}, ${s1.id}, 1, '08:00', '11:00')`;
    return { s1: s1.id, s2: s2.id, owners: users.map((u) => u.id) };
  });
  service = ids.s1;
  second = ids.s2;
  owners = ids.owners;
});

const input = (over: Partial<RequestInput> = {}): RequestInput => ({
  serviceId: service, startsAt: TEN, partySize: 1, name: 'Aisyah', phone: '60123456789', note: null,
  submissionKey: crypto.randomUUID(), ...over,
});
const send = async (value: RequestInput) => createBookingRequest(ENV, A, value, await submissionDigest(value), NOW);

describe('booking references', () => {
  it('are six characters with no 0, O, 1 or I', () => {
    for (let i = 0; i < 200; i += 1) expect(newReference()).toMatch(REFERENCE);
    expect(newReference(() => new Uint8Array([0, 1, 2, 3, 30, 31]))).toBe('ABCD89');
  });
});

describe('parseRequestForm', () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const good = { service: '11111111-1111-4111-8111-111111111112', start: TEN.toISOString(), party: '2',
    name: '  Aisyah   binti Ali ', phone: '012-345 6789', note: '', submission_key: '11111111-1111-4111-8111-111111111113' };

  it('normalises a good form', () => {
    const parsed = parseRequestForm(form(good));
    expect(parsed).toEqual({ ok: true, value: {
      serviceId: good.service, startsAt: TEN, partySize: 2, name: 'Aisyah binti Ali', phone: '60123456789',
      note: null, submissionKey: good.submission_key,
    } });
  });

  it('reads URLSearchParams exactly as FormData', () => {
    expect(parseRequestForm(new URLSearchParams(good))).toEqual(parseRequestForm(form(good)));
  });

  it('refuses control and direction characters in the name', () => {
    /* A NUL reaches Postgres as SQLSTATE 22021, a 500; the rest reach the
       owner's push and WhatsApp text, where a direction override can make a
       name read as something else. */
    for (const name of ['Ais\u0000yah', 'Ais\u0007yah', 'Ais\tyah', 'Ais\nyah', 'Aisyah\u001F', 'Aisyah\u007F',
      'Ais\u0085yah', 'Ais\u009Fyah', 'Ais\u200Eyah', 'Ais\u200Fyah', '\u202Ehaysia', 'Ais\u202Ayah', 'Ais\u2066yah', 'Ais\u2069yah']) {
      const parsed = parseRequestForm(form({ ...good, name }));
      expect(parsed.ok ? [] : parsed.errors, JSON.stringify(name)).toEqual(['name']);
    }
    expect(parseRequestForm(form({ ...good, name: 'Siti Nur\u2019aini \u0639\u0627\u0626\u0634\u0629' })).ok).toBe(true);
  });

  it('refuses the same characters in the note, except tabs and line breaks', () => {
    for (const note of ['a\u0000b', 'a\u0008b', 'a\u000Bb', 'a\u001Bb', 'a\u007Fb', 'a\u0080b', 'a\u202Eb', 'a\u200Eb', 'a\u2068b']) {
      const parsed = parseRequestForm(form({ ...good, note }));
      expect(parsed.ok ? [] : parsed.errors, JSON.stringify(note)).toEqual(['note']);
    }
    const lines = parseRequestForm(form({ ...good, note: 'Window seat\r\nNo sugar,\tplease' }));
    expect(lines.ok && lines.value.note).toBe('Window seat\r\nNo sugar,\tplease');
  });

  it('names every bad field', () => {
    const parsed = parseRequestForm(form({ ...good, name: ' ', phone: '12345', party: '0', note: 'x'.repeat(501), start: 'tomorrow' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.sort()).toEqual(['name', 'note', 'partySize', 'phone', 'start']);
  });
});

describe('createBookingRequest', () => {
  it('creates a pending booking with snapshots and tells every owner where it is', async () => {
    const result = await send(input({ partySize: 1, note: 'Window seat' }));
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(result.reference).toMatch(REFERENCE);
    const [row] = await asOwner((sql) => sql<{ status: string; service_name: string; ends_at: Date; created_at: Date }[]>`
      select status, service_name, ends_at, created_at from booking where id = ${result.bookingId}`);
    expect(row).toMatchObject({ status: 'pending', service_name: 'Cupping class' });
    expect(row.ends_at.toISOString()).toBe('2026-10-06T03:00:00.000Z');
    expect(row.created_at.toISOString()).toBe(NOW.toISOString());
    const notes = await asOwner((sql) => sql<{ recipient_user_id: string; kind: string; url: string; body: string }[]>`
      select recipient_user_id, kind, url, body from notification order by recipient_user_id`);
    expect(notes.map((n) => n.recipient_user_id).sort()).toEqual([...owners].sort());
    expect(notes[0]).toMatchObject({ kind: 'booking_requested', url: `/app?view=apps&app=bookings&booking=${result.bookingId}` });
    expect(notes[0].body).toContain('Aisyah');
  });

  it('returns the original receipt for an identical replay, and refuses a changed one', async () => {
    const value = input();
    const first = await send(value);
    const again = await send(value);
    expect(again).toEqual({ kind: 'replayed', reference: first.kind === 'created' ? first.reference : '' });
    expect(await send({ ...value, name: 'Someone else' })).toEqual({ kind: 'changed' });
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
    expect(await asOwner((sql) => sql`select 1 from notification`)).toHaveLength(2);
    expect(await findSubmission(ENV, A, value.submissionKey, await submissionDigest(value)))
      .toEqual({ kind: 'replayed', reference: first.kind === 'created' ? first.reference : '' });
  });

  it('creates one booking when the same form is sent twice at once', async () => {
    const value = input();
    const results = await Promise.all([send(value), send(value)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['created', 'replayed']);
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(1);
  });

  it('gives the last place to exactly one of two customers', async () => {
    const results = await Promise.all([send(input()), send(input())]);
    expect(results.map((r) => r.kind).sort()).toEqual(['created', 'taken']);
  });

  it('refuses a start the page never offered, one inside the notice, and a party larger than the places left', async () => {
    expect((await send(input({ startsAt: new Date('2026-10-06T02:30:00Z') }))).kind).toBe('taken');
    expect((await send(input({ startsAt: new Date('2026-10-05T01:00:00Z') }))).kind).toBe('taken');
    expect((await send(input({ serviceId: second, partySize: 6 }))).kind).toBe('taken');
  });

  it('rechecks manual closures and cached Calendar busy time when an old form is submitted', async () => {
    await asOwner((sql) => sql`insert into booking_block (business_id, label, starts_at, ends_at)
      values (${A}, 'Closed', ${TEN}, ${new Date(TEN.getTime() + 3_600_000)})`);
    expect((await send(input())).kind).toBe('taken');
    await asOwner(async (sql) => {
      await sql`delete from booking_block where business_id = ${A}`;
      const [connection] = await sql<{ id: string }[]>`insert into connection
        (business_id, connector, method, status) values (${A}, 'google', 'oauth', 'connected') returning id`;
      await sql`insert into booking_calendar_busy
        (business_id, connection_id, event_key, starts_at, ends_at)
        values (${A}, ${connection.id}, 'external-busy', ${TEN}, ${new Date(TEN.getTime() + 3_600_000)})`;
    });
    expect((await send(input())).kind).toBe('taken');
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('refuses when the owner has paused, even for a form opened before', async () => {
    await asOwner((sql) => sql`update booking_settings set accepting = false where business_id = ${A}`);
    expect((await send(input())).kind).toBe('unavailable');
    await asOwner((sql) => sql`update booking_settings set accepting = true where business_id = ${A}`);
    await asOwner((sql) => sql`update app_installation set state = 'paused' where business_id = ${A}`);
    expect((await send(input())).kind).toBe('unavailable');
    expect(await asOwner((sql) => sql`select 1 from booking`)).toHaveLength(0);
  });

  it('never books another business\'s service, and writes nothing for either', async () => {
    const B = '22222222-2222-4222-8222-222222222222';
    const theirs = await asOwner(async (sql) => {
      await sql`insert into business (id, name, playbook_key, onboarded, lang) values (${B}, 'Other Barber', 'services', true, 'en')`;
      await sql`insert into app_installation (business_id, app_key, public_slug) values (${B}, 'bookings', 'other-barber')`;
      await sql`insert into booking_settings (business_id, availability_acknowledged_at, min_notice_minutes, horizon_days)
        values (${B}, now(), 120, 30)`;
      const [s] = await sql<{ id: string }[]>`insert into booking_service (business_id, name, duration_minutes, capacity)
        values (${B}, 'Haircut', 60, 5) returning id`;
      await sql`insert into booking_hours (business_id, service_id, weekday, opens, closes) values (${B}, ${s.id}, 2, '10:00', '13:00')`;
      return s.id;
    });
    expect(await send(input({ serviceId: theirs }))).toEqual({ kind: 'service_gone' });
    expect(await asOwner((sql) => sql`select business_id from booking`)).toHaveLength(0);
    expect(await asOwner((sql) => sql`select 1 from notification`)).toHaveLength(0);
    // The same request is bookable at its own business: only the tenant boundary refused it.
    const own = input({ serviceId: theirs });
    expect((await createBookingRequest(ENV, B, own, await submissionDigest(own), NOW)).kind).toBe('created');
  });

  it('refuses a service that is no longer offered', async () => {
    await asOwner((sql) => sql`update booking_service set active = false where id = ${service}`);
    expect((await send(input())).kind).toBe('service_gone');
  });

  it('holds the daily cap across services, even when two requests race for the last one', async () => {
    await asOwner((sql) => sql`insert into booking (business_id, reference, submission_key, submission_hash, service_id,
      service_name, starts_at, ends_at, party_size, customer_name, customer_phone, status, created_at)
      select ${A}, 'Z' || translate(lpad(g::text, 5, '0'), '01', 'AB'), gen_random_uuid(), 'h', ${second}, 'Espresso basics',
        '2026-11-01T02:00:00Z', '2026-11-01T03:00:00Z', 1, 'Filler', '60123456789', 'declined', ${NOW}
      from generate_series(1, ${DAILY_CAP - 1}::int) g`);
    const results = await Promise.all([send(input()), send(input({ serviceId: second }))]);
    expect(results.map((r) => r.kind).sort()).toEqual(['created', 'daily_cap']);
    const created = results.find((r) => r.kind === 'created');
    expect(created).toBeDefined();
  });
});
