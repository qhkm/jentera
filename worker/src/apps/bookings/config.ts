import type postgres from 'postgres';
import { hoursFor, readHours } from './hours';
import { peakReserved } from './slots';
import { clockMinutes, isClock } from './time';

/* An owner's Bookings configuration: the installation (link and version),
   the settings, the services and their weekly hours. Saving is all or
   nothing: a refusal throws ConfigError so the whole transaction rolls back. */

export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['api', 'admin', 'www', 'app', 'b']);
export const MAX_SERVICES = 20;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = '23505';

export interface HoursInput { weekday: number; opens: string; closes: string }
export interface ServiceInput {
  id: string | null;
  name: string;
  description: string | null;
  durationMinutes: number;
  capacity: number;
  priceLabel: string | null;
  active: boolean;
  hours: HoursInput[];
}
export interface ConfigInput {
  version: number | null;
  slug: string;
  accepting: boolean;
  minNoticeMinutes: number;
  changeCutoffMinutes: number;
  horizonDays: number;
  location: string | null;
  acknowledgeAvailabilityLimits: boolean;
  services: ServiceInput[];
}
export interface ServiceView extends Omit<ServiceInput, 'id'> { id: string }
export interface ConfigView {
  installation: { slug: string; state: 'active' | 'paused'; publicUrl: string } | null;
  version: number | null;
  settings: { accepting: boolean; minNoticeMinutes: number; changeCutoffMinutes: number; horizonDays: number; location: string | null; availabilityAcknowledgedAt: string } | null;
  services: ServiceView[];
}

export type ConfigErrorCode = 'CONFIG_CHANGED' | 'SLUG_TAKEN' | 'ACK_REQUIRED' | 'UNKNOWN_SERVICE' | 'CAPACITY_BELOW_RESERVED';
export class ConfigError extends Error {
  constructor(readonly code: ConfigErrorCode, readonly serviceId: string | null = null) {
    super(code);
  }
}

type Parsed<T> = { ok: true; value: T } | { ok: false; err: string };
const fail = (err: string): { ok: false; err: string } => ({ ok: false, err });

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length >= 1 && clean.length <= max ? clean : null;
}

function optionalText(value: unknown, max: number): Parsed<string | null> {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const valueText = text(raw, max);
  return valueText ? { ok: true, value: valueText } : fail(`text must be at most ${max} characters`);
}

export function publicBookingUrl(sitesOrigin: string, slug: string): string {
  return `${sitesOrigin.replace(/\/+$/, '')}/b/${slug}`;
}

export function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return SLUG.test(slug) && !RESERVED_SLUGS.has(slug) ? slug : null;
}

function parseHours(value: unknown): Parsed<HoursInput[]> {
  if (!Array.isArray(value) || value.length > 28) return fail('hours must be a list of at most 28 ranges');
  const hours: HoursInput[] = [];
  for (const raw of value) {
    const range = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const weekday = int(range.weekday, 0, 6);
    const opens = typeof range.opens === 'string' ? range.opens : '';
    const closes = typeof range.closes === 'string' ? range.closes : '';
    if (weekday === null || !isClock(opens) || !isClock(closes)) {
      return fail('each range needs a weekday 0-6 and HH:MM times from 00:00 to 23:59');
    }
    if (clockMinutes(closes) <= clockMinutes(opens)) {
      return fail('closing time must be after opening time on the same day; overnight hours are not supported');
    }
    hours.push({ weekday, opens, closes });
  }
  hours.sort((a, b) => a.weekday - b.weekday || clockMinutes(a.opens) - clockMinutes(b.opens));
  for (let i = 1; i < hours.length; i += 1) {
    if (hours[i].weekday === hours[i - 1].weekday && clockMinutes(hours[i].opens) < clockMinutes(hours[i - 1].closes)) {
      return fail('opening hours on the same day overlap');
    }
  }
  return { ok: true, value: hours };
}

function parseService(value: unknown): Parsed<ServiceInput> {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const id = raw.id === undefined || raw.id === null ? null
    : typeof raw.id === 'string' && UUID.test(raw.id) ? raw.id.toLowerCase() : undefined;
  if (id === undefined) return fail('service id is not valid');
  const name = text(raw.name, 80);
  if (!name) return fail('service name must be 1 to 80 characters');
  const description = optionalText(raw.description, 240);
  if (!description.ok) return fail('service description must be at most 240 characters');
  const durationMinutes = int(raw.durationMinutes, 15, 480);
  if (durationMinutes === null || durationMinutes % 15 !== 0) return fail('duration must be 15 to 480 minutes in 15-minute steps');
  const capacity = int(raw.capacity, 1, 50);
  if (capacity === null) return fail('places per time must be 1 to 50');
  const priceRaw = typeof raw.priceLabel === 'string' ? raw.priceLabel.trim() : raw.priceLabel;
  const priceLabel = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : text(priceRaw, 40);
  if (priceLabel === null && priceRaw !== undefined && priceRaw !== null && priceRaw !== '') {
    return fail('price label must be at most 40 characters');
  }
  const active = raw.active === undefined ? true : raw.active;
  if (typeof active !== 'boolean') return fail('active must be true or false');
  const hours = parseHours(raw.hours ?? []);
  if (!hours.ok) return hours;
  return { ok: true, value: { id, name, description: description.value, durationMinutes, capacity, priceLabel, active, hours: hours.value } };
}

export function parseConfigInput(body: unknown): Parsed<ConfigInput> {
  if (!body || typeof body !== 'object') return fail('a JSON object is required');
  const raw = body as Record<string, unknown>;
  const version = raw.version === null || raw.version === undefined ? null : int(raw.version, 1, 2_147_483_647);
  if (version === null && raw.version !== null && raw.version !== undefined) return fail('version is not valid');
  const slug = normalizeSlug(raw.slug);
  if (!slug) return fail('link name must be 3 to 40 lowercase letters, numbers or dashes, and not a reserved word');
  if (typeof raw.accepting !== 'boolean') return fail('accepting must be true or false');
  const minNoticeMinutes = int(raw.minNoticeMinutes, 0, 10080);
  if (minNoticeMinutes === null) return fail('minimum notice must be 0 to 10080 minutes');
  const changeCutoffMinutes = int(raw.changeCutoffMinutes, 0, 10080);
  if (changeCutoffMinutes === null) return fail('change cutoff must be 0 to 10080 minutes');
  const horizonDays = int(raw.horizonDays, 1, 90);
  if (horizonDays === null) return fail('booking horizon must be 1 to 90 days');
  const location = optionalText(raw.location, 160);
  if (!location.ok) return fail('location must be at most 160 characters');
  if (!Array.isArray(raw.services) || raw.services.length < 1 || raw.services.length > MAX_SERVICES) {
    return fail(`add between 1 and ${MAX_SERVICES} services`);
  }
  const services: ServiceInput[] = [];
  for (const value of raw.services) {
    const parsed = parseService(value);
    if (!parsed.ok) return parsed;
    services.push(parsed.value);
  }
  const ids = services.map((s) => s.id).filter((id): id is string => id !== null);
  if (new Set(ids).size !== ids.length) return fail('a service appears twice');
  if (!services.some((s) => s.active)) return fail('at least one service must be active');
  return {
    ok: true,
    value: {
      version, slug, accepting: raw.accepting, minNoticeMinutes, changeCutoffMinutes, horizonDays, location: location.value,
      acknowledgeAvailabilityLimits: raw.acknowledgeAvailabilityLimits === true, services,
    },
  };
}

export async function readConfig(tx: postgres.TransactionSql, businessId: string, sitesOrigin: string): Promise<ConfigView> {
  const [installation] = await tx<{ public_slug: string; state: 'active' | 'paused'; config_version: number }[]>`
    select public_slug, state, config_version from app_installation
     where business_id = ${businessId} and app_key = 'bookings'`;
  if (!installation) return { installation: null, version: null, settings: null, services: [] };
  const [settings] = await tx<{ accepting: boolean; min_notice_minutes: number; change_cutoff_minutes: number; horizon_days: number; location: string | null; availability_acknowledged_at: Date }[]>`
    select accepting, min_notice_minutes, change_cutoff_minutes, horizon_days, location, availability_acknowledged_at
      from booking_settings where business_id = ${businessId}`;
  const services = await tx<{ id: string; name: string; description: string | null; duration_minutes: number; capacity: number; price_label: string | null; active: boolean }[]>`
    select id, name, description, duration_minutes, capacity, price_label, active from booking_service
     where business_id = ${businessId} order by sort, name, id`;
  const hours = await readHours(tx, businessId);
  return {
    installation: {
      slug: installation.public_slug,
      state: installation.state,
      publicUrl: publicBookingUrl(sitesOrigin, installation.public_slug),
    },
    version: installation.config_version,
    settings: settings ? {
      accepting: settings.accepting,
      minNoticeMinutes: settings.min_notice_minutes,
      changeCutoffMinutes: settings.change_cutoff_minutes,
      horizonDays: settings.horizon_days,
      location: settings.location,
      availabilityAcknowledgedAt: settings.availability_acknowledged_at.toISOString(),
    } : null,
    services: services.map((s) => ({
      id: s.id, name: s.name, description: s.description, durationMinutes: s.duration_minutes, capacity: s.capacity,
      priceLabel: s.price_label, active: s.active,
      hours: hoursFor(hours, s.id),
    })),
  };
}

/** Record a link name for this business. A name any business has published
    stays with it: another business gets SLUG_TAKEN, and a business may go
    back to one of its own earlier names. Row-level security hides other
    businesses' names, so a row this query can see is this business's own. */
async function claimName(tx: postgres.TransactionSql, businessId: string, slug: string): Promise<void> {
  const [claimed] = await tx<{ public_slug: string }[]>`
    insert into app_slug (public_slug, business_id, app_key)
    values (${slug}, ${businessId}, 'bookings')
    on conflict (public_slug) do nothing
    returning public_slug`;
  if (claimed) return;
  const [own] = await tx`select 1 from app_slug where public_slug = ${slug} and business_id = ${businessId}`;
  if (!own) throw new ConfigError('SLUG_TAKEN');
}

async function claimSlug<T>(tx: postgres.TransactionSql, write: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  try {
    return (await tx.savepoint((sp) => write(sp))) as T;
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new ConfigError('SLUG_TAKEN');
    throw error;
  }
}

/** Save everything or nothing. Locks in the common order: the installation,
    then services in id order. */
export async function saveConfig(tx: postgres.TransactionSql, businessId: string, input: ConfigInput, now: Date): Promise<void> {
  const [existing] = await tx<{ public_slug: string; config_version: number }[]>`
    select public_slug, config_version from app_installation
     where business_id = ${businessId} and app_key = 'bookings' for update`;
  if (!existing) {
    if (input.version !== null) throw new ConfigError('CONFIG_CHANGED');
    if (!input.acknowledgeAvailabilityLimits) throw new ConfigError('ACK_REQUIRED');
    await claimName(tx, businessId, input.slug);
    const inserted = await claimSlug(tx, (sp) => sp<{ business_id: string }[]>`
      insert into app_installation (business_id, app_key, public_slug)
      values (${businessId}, 'bookings', ${input.slug})
      on conflict (business_id, app_key) do nothing returning business_id`);
    // Lost a race with a concurrent first save: the client must reload.
    if (inserted.length === 0) throw new ConfigError('CONFIG_CHANGED');
    await tx`insert into booking_settings
      (business_id, accepting, availability_acknowledged_at, min_notice_minutes, change_cutoff_minutes, horizon_days, location, updated_at)
      values (${businessId}, ${input.accepting}, ${now}, ${input.minNoticeMinutes}, ${input.changeCutoffMinutes}, ${input.horizonDays}, ${input.location}, ${now})`;
  } else {
    if (input.version !== existing.config_version) throw new ConfigError('CONFIG_CHANGED');
    if (input.slug !== existing.public_slug) {
      await claimName(tx, businessId, input.slug);
      await claimSlug(tx, (sp) => sp`update app_installation set public_slug = ${input.slug}
        where business_id = ${businessId} and app_key = 'bookings'`);
    }
    const updated = await tx`update booking_settings
      set accepting = ${input.accepting}, min_notice_minutes = ${input.minNoticeMinutes},
          change_cutoff_minutes = ${input.changeCutoffMinutes}, horizon_days = ${input.horizonDays}, location = ${input.location}, updated_at = ${now}
      where business_id = ${businessId} returning business_id`;
    if (updated.length === 0) {
      if (!input.acknowledgeAvailabilityLimits) throw new ConfigError('ACK_REQUIRED');
      await tx`insert into booking_settings
        (business_id, accepting, availability_acknowledged_at, min_notice_minutes, change_cutoff_minutes, horizon_days, location, updated_at)
        values (${businessId}, ${input.accepting}, ${now}, ${input.minNoticeMinutes}, ${input.changeCutoffMinutes}, ${input.horizonDays}, ${input.location}, ${now})`;
    }
    await tx`update app_installation set config_version = config_version + 1, updated_at = ${now}
      where business_id = ${businessId} and app_key = 'bookings'`;
  }
  await saveServices(tx, businessId, input.services, now);
}

async function saveServices(tx: postgres.TransactionSql, businessId: string, services: ServiceInput[], now: Date): Promise<void> {
  const existing = await tx<{ id: string; capacity: number }[]>`
    select id, capacity from booking_service where business_id = ${businessId} order by id for update`;
  const known = new Map(existing.map((s) => [s.id, s]));
  for (const service of services) {
    if (service.id && !known.has(service.id)) throw new ConfigError('UNKNOWN_SERVICE', service.id);
  }
  for (const service of services) {
    const before = service.id ? known.get(service.id) : undefined;
    if (!before || service.capacity >= before.capacity) continue;
    const held = await tx<{ starts_at: Date; ends_at: Date; party_size: number }[]>`
      select starts_at, ends_at, party_size from booking
       where business_id = ${businessId} and service_id = ${before.id}
         and status in ('pending', 'confirmed') and ends_at > ${now}`;
    const peak = peakReserved(held.map((h) => ({ startsAt: h.starts_at, endsAt: h.ends_at, partySize: h.party_size })), now);
    if (peak > service.capacity) throw new ConfigError('CAPACITY_BELOW_RESERVED', before.id);
  }
  const kept = new Set<string>();
  for (const [sort, service] of services.entries()) {
    let id = service.id;
    if (id) {
      await tx`update booking_service
        set name = ${service.name}, duration_minutes = ${service.durationMinutes}, capacity = ${service.capacity},
            description = ${service.description}, price_label = ${service.priceLabel}, active = ${service.active}, sort = ${sort}
        where business_id = ${businessId} and id = ${id}`;
    } else {
      const [created] = await tx<{ id: string }[]>`
        insert into booking_service (business_id, name, description, duration_minutes, capacity, price_label, active, sort)
        values (${businessId}, ${service.name}, ${service.description}, ${service.durationMinutes}, ${service.capacity},
                ${service.priceLabel}, ${service.active}, ${sort})
        returning id`;
      id = created.id;
    }
    kept.add(id);
    await tx`delete from booking_hours where business_id = ${businessId} and service_id = ${id}`;
    for (const range of service.hours) {
      await tx`insert into booking_hours (business_id, service_id, weekday, opens, closes)
        values (${businessId}, ${id}, ${range.weekday}, ${range.opens}, ${range.closes})`;
    }
  }
  for (const old of existing) {
    if (kept.has(old.id)) continue;
    const [used] = await tx`select 1 from booking where business_id = ${businessId} and service_id = ${old.id} limit 1`;
    if (used) {
      // Its bookings stay reachable; only new requests stop.
      await tx`update booking_service set active = false where business_id = ${businessId} and id = ${old.id}`;
    } else {
      await tx`delete from booking_service where business_id = ${businessId} and id = ${old.id}`;
    }
  }
}
