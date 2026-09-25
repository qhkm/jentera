import type postgres from 'postgres';
import { withTenant, withUser, type DatabaseEnv } from '../../db';
import { hoursFor, readHours } from './hours';
import type { Lang } from './messages';
import { openSlots, type OpenSlot, type Reservation } from './slots';
import { addDays, myDate, myInstant } from './time';
import { blockedIntervalsFor } from './availability';

/* What a business's customers may see, read for the public booking pages.
   The business is found only through bookings_by_slug; everything after
   runs inside withTenant, so row-level security scopes every read. */

export interface PublicService {
  id: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  capacity: number;
  priceLabel: string | null;
  hours: { weekday: number; opens: string; closes: string }[];
}

export interface PublicPage {
  businessName: string;
  lang: Lang;
  /** Taking new requests: the installation is active and the owner has not paused it. */
  open: boolean;
  settings: { minNoticeMinutes: number; horizonDays: number; location: string | null };
  services: PublicService[];
}

export interface DayTimes { date: string; slots: OpenSlot[] }

export async function resolvePublicSlug(env: DatabaseEnv, slug: string): Promise<{ businessId: string; currentSlug: string } | null> {
  const [row] = await withUser(env, (sql) => sql<{ business_id: string; current_slug: string }[]>`
    select business_id, current_slug from public.bookings_by_slug(${slug})`);
  return row ? { businessId: row.business_id, currentSlug: row.current_slug } : null;
}

export async function readPublicPage(tx: postgres.TransactionSql, businessId: string): Promise<PublicPage | null> {
  const [business] = await tx<{ name: string; lang: Lang }[]>`select name, lang from business where id = ${businessId}`;
  const [installed] = await tx<{ state: 'active' | 'paused' }[]>`
    select state from app_installation where business_id = ${businessId} and app_key = 'bookings'`;
  const [settings] = await tx<{ accepting: boolean; min_notice_minutes: number; horizon_days: number; location: string | null }[]>`
    select accepting, min_notice_minutes, horizon_days, location from booking_settings where business_id = ${businessId}`;
  if (!business || !installed || !settings) return null;
  // duration_minutes > 0 guards openSlots, whose loop would never end on zero.
  const services = await tx<{ id: string; name: string; description: string | null; duration_minutes: number; capacity: number; price_label: string | null }[]>`
    select id, name, description, duration_minutes, capacity, price_label from booking_service
     where business_id = ${businessId} and active and duration_minutes > 0
     order by sort, name, id`;
  const hours = await readHours(tx, businessId);
  return {
    businessName: business.name,
    lang: business.lang,
    open: installed.state === 'active' && settings.accepting,
    settings: { minNoticeMinutes: settings.min_notice_minutes, horizonDays: settings.horizon_days, location: settings.location },
    services: services.map((s) => ({
      id: s.id, name: s.name, description: s.description, durationMinutes: s.duration_minutes, capacity: s.capacity, priceLabel: s.price_label,
      hours: hoursFor(hours, s.id),
    })),
  };
}

export async function loadPublicPage(env: DatabaseEnv, businessId: string): Promise<PublicPage | null> {
  return withTenant(env, businessId, (tx) => readPublicPage(tx, businessId));
}

/** Pending and confirmed bookings of one service overlapping [from, to). */
export async function reservationsFor(
  tx: postgres.TransactionSql,
  businessId: string,
  serviceId: string,
  from: Date,
  to: Date,
  excludeBookingId?: string,
): Promise<Reservation[]> {
  const rows = await tx<{ starts_at: Date; ends_at: Date; party_size: number }[]>`
    select starts_at, ends_at, party_size from booking
       where business_id = ${businessId} and service_id = ${serviceId}
       and status in ('pending', 'confirmed') and starts_at < ${to} and ends_at > ${from}
       ${excludeBookingId ? tx`and id <> ${excludeBookingId}` : tx``}`;
  return rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at, partySize: r.party_size }));
}

/** Open times for one service over `days` Malaysian days from `from`,
    starting no earlier than today. Horizon and notice come from openSlots. */
export async function loadOpenTimes(
  env: DatabaseEnv,
  businessId: string,
  serviceId: string,
  from: string,
  days: number,
  now: Date,
  excludeBookingId?: string,
): Promise<{ page: PublicPage; service: PublicService; days: DayTimes[] } | null> {
  return withTenant(env, businessId, async (tx) => {
    const page = await readPublicPage(tx, businessId);
    const service = page?.services.find((s) => s.id === serviceId);
    if (!page || !service) return null;
    const today = myDate(now);
    const start = from < today ? today : from;
    const windowStart = myInstant(start);
    const windowEnd = myInstant(addDays(start, days));
    const [reservations, blocked] = await Promise.all([
      reservationsFor(tx, businessId, service.id, windowStart, windowEnd, excludeBookingId),
      blockedIntervalsFor(tx, businessId, windowStart, windowEnd),
    ]);
    const slots = openSlots({ service, hours: service.hours, settings: page.settings, reservations, blocked, now, from: start, days });
    const out: DayTimes[] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const date = addDays(start, offset);
      out.push({ date, slots: slots.filter((slot) => myDate(slot.startsAt) === date) });
    }
    return { page, service, days: out };
  });
}
