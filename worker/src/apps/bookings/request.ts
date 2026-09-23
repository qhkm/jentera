import type postgres from 'postgres';
import { withTenant, type DatabaseEnv } from '../../db';
import { createNotification } from '../../notifications/store';
import { ownersOf } from '../../notifications/recipients';
import { readHours } from './hours';
import { whenText, type Lang } from './messages';
import { normalizeMyPhone } from './phone';
import { reservationsFor } from './public';
import { newReference } from './reference';
import { openSlots } from './slots';
import { addDays, myDate, myInstant } from './time';

/* A customer's booking request from the public page. Creation locks the
   installation first (which serialises it with config saves, decisions and
   the daily cap), then the service, then reads bookings; a submission key
   makes a retried or double-tapped form one request, not two. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** C0 and C1 controls, and the bidi marks, embeddings, overrides and
    isolates. A NUL is refused by Postgres (a 500); the rest would reach the
    owner's push and WhatsApp text, where an override can disguise a name. */
const CONTROL_IN_NAME = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
/** The same, less tab, line feed and carriage return: a note may have lines. */
const CONTROL_IN_NOTE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
export const DAILY_CAP = 200;
const REFERENCE_ATTEMPTS = 5;

export interface RequestInput {
  serviceId: string;
  startsAt: Date;
  partySize: number;
  name: string;
  phone: string;
  note: string | null;
  submissionKey: string;
}

export type RequestField = 'service' | 'start' | 'name' | 'phone' | 'partySize' | 'note' | 'submission';
export type ParsedRequest =
  | { ok: true; value: RequestInput }
  | { ok: false; errors: RequestField[]; raw: Record<string, string> };

export type CreateResult =
  | { kind: 'created'; reference: string; bookingId: string }
  | { kind: 'replayed'; reference: string }
  | { kind: 'changed' }
  | { kind: 'unavailable' }
  | { kind: 'daily_cap' }
  | { kind: 'service_gone' }
  | { kind: 'taken' };

/** Anything with a `get` by field name: the sites handler's URLSearchParams,
    or a FormData. Only string values count. */
export interface FormFields { get(name: string): unknown }

export function parseRequestForm(form: FormFields): ParsedRequest {
  const raw: Record<string, string> = {};
  for (const key of ['service', 'start', 'party', 'name', 'phone', 'note', 'submission_key']) {
    const value = form.get(key);
    raw[key] = typeof value === 'string' ? value : '';
  }
  const errors: RequestField[] = [];
  const serviceId = UUID.test(raw.service) ? raw.service.toLowerCase() : '';
  if (!serviceId) errors.push('service');
  const startsAt = new Date(raw.start);
  const startOk = !Number.isNaN(startsAt.getTime()) && startsAt.getUTCSeconds() === 0 && startsAt.getUTCMilliseconds() === 0;
  if (!startOk) errors.push('start');
  const partySize = /^\d{1,2}$/.test(raw.party) ? Number(raw.party) : 0;
  if (partySize < 1 || partySize > 50) errors.push('partySize');
  const name = raw.name.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 80 || CONTROL_IN_NAME.test(raw.name)) errors.push('name');
  const phone = normalizeMyPhone(raw.phone);
  if (!phone) errors.push('phone');
  const noteText = raw.note.trim();
  if (noteText.length > 500 || CONTROL_IN_NOTE.test(raw.note)) errors.push('note');
  const submissionKey = UUID.test(raw.submission_key) ? raw.submission_key.toLowerCase() : '';
  if (!submissionKey) errors.push('submission');
  if (errors.length > 0) return { ok: false, errors, raw };
  return {
    ok: true,
    value: { serviceId, startsAt, partySize, name, phone: phone!, note: noteText || null, submissionKey },
  };
}

/** The normalized request, hashed. The Turnstile token is not part of it, so
    a replay with a fresh token still matches. */
export async function submissionDigest(input: RequestInput): Promise<string> {
  const text = JSON.stringify([input.serviceId, input.startsAt.toISOString(), input.name, input.phone, input.partySize, input.note ?? '']);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function matchSubmission(
  tx: postgres.TransactionSql,
  businessId: string,
  key: string,
  digest: string,
): Promise<{ kind: 'replayed'; reference: string } | { kind: 'changed' } | null> {
  const [row] = await tx<{ reference: string; submission_hash: string }[]>`
    select reference, submission_hash from booking where business_id = ${businessId} and submission_key = ${key}`;
  if (!row) return null;
  return row.submission_hash === digest ? { kind: 'replayed', reference: row.reference } : { kind: 'changed' };
}

/** A committed submission with this key, if any. Runs before Turnstile, since
    the original token may already have been spent. Only a generic receipt
    comes back, never customer data. */
export async function findSubmission(env: DatabaseEnv, businessId: string, key: string, digest: string) {
  return withTenant(env, businessId, (tx) => matchSubmission(tx, businessId, key, digest));
}

const NOTICE: Record<Lang, (name: string, when: string, service: string, party: number) => { title: string; body: string }> = {
  en: (name, when, service, party) => ({ title: 'New booking request', body: `${name} · ${when} · ${service} (${party})` }),
  bm: (name, when, service, party) => ({ title: 'Permintaan tempahan baharu', body: `${name} · ${when} · ${service} (${party})` }),
};

export async function createBookingRequest(
  env: DatabaseEnv,
  businessId: string,
  input: RequestInput,
  digest: string,
  now: Date,
): Promise<CreateResult> {
  return withTenant(env, businessId, async (tx): Promise<CreateResult> => {
    const [installed] = await tx<{ state: 'active' | 'paused' }[]>`
      select state from app_installation where business_id = ${businessId} and app_key = 'bookings' for update`;
    if (!installed) return { kind: 'unavailable' };
    const replay = await matchSubmission(tx, businessId, input.submissionKey, digest);
    if (replay) return replay;
    const [settings] = await tx<{ accepting: boolean; min_notice_minutes: number; horizon_days: number }[]>`
      select accepting, min_notice_minutes, horizon_days from booking_settings where business_id = ${businessId}`;
    if (installed.state !== 'active' || !settings?.accepting) return { kind: 'unavailable' };

    const [{ today }] = await tx<{ today: number }[]>`
      select count(*)::int as today from booking where business_id = ${businessId} and created_at >= ${myInstant(myDate(now))}`;
    if (today >= DAILY_CAP) return { kind: 'daily_cap' };

    const [service] = await tx<{ id: string; name: string; duration_minutes: number; capacity: number }[]>`
      select id, name, duration_minutes, capacity from booking_service
       where business_id = ${businessId} and id = ${input.serviceId} and active and duration_minutes > 0
       for update`;
    if (!service) return { kind: 'service_gone' };
    const hours = await readHours(tx, businessId, service.id);
    const date = myDate(input.startsAt);
    const reservations = await reservationsFor(tx, businessId, service.id, myInstant(date), myInstant(addDays(date, 1)));
    const slot = openSlots({
      service: { durationMinutes: service.duration_minutes, capacity: service.capacity },
      hours,
      settings: { minNoticeMinutes: settings.min_notice_minutes, horizonDays: settings.horizon_days },
      reservations,
      now,
      from: date,
      days: 1,
    }).find((s) => s.startsAt.getTime() === input.startsAt.getTime());
    if (!slot || slot.remaining < input.partySize) return { kind: 'taken' };

    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
      const reference = newReference();
      const [row] = await tx<{ id: string }[]>`
        insert into booking (business_id, reference, submission_key, submission_hash, service_id, service_name,
          starts_at, ends_at, party_size, customer_name, customer_phone, note, created_at)
        values (${businessId}, ${reference}, ${input.submissionKey}, ${digest}, ${service.id}, ${service.name},
          ${slot.startsAt}, ${slot.endsAt}, ${input.partySize}, ${input.name}, ${input.phone}, ${input.note}, ${now})
        on conflict (business_id, reference) do nothing
        returning id`;
      if (!row) continue;
      const [business] = await tx<{ lang: Lang }[]>`select lang from business where id = ${businessId}`;
      const lang: Lang = business?.lang === 'bm' ? 'bm' : 'en';
      const notice = NOTICE[lang](input.name, whenText(slot.startsAt, lang), service.name, input.partySize);
      for (const owner of await ownersOf(tx, businessId)) {
        await createNotification(tx, businessId, {
          recipientUserId: owner,
          kind: 'booking_requested',
          title: notice.title,
          body: notice.body,
          sourceKey: `booking:${row.id}`,
          url: `/app?view=apps&app=bookings&booking=${row.id}`,
        });
      }
      return { kind: 'created', reference, bookingId: row.id };
    }
    throw new Error('could not allocate a booking reference');
  });
}
